/**
 * useBatchUpload — manages batch state + per-file upload mutations.
 *
 * Owns: cards array, batchFolderId, batchBranch, batchUploading.
 * Exposes: scanCard, rescanCard, updateCardField, updateCardDocType,
 *          removeCard, resetBatch, revertCardField, toggleCardLock, uploadAll.
 */

import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import { HttpError } from '@/lib/http';
import {
  previewDocument,
  uploadDocumentWithKey,
  type Extraction,
} from '../api';
import { analyzeDocument } from '@/modules/docbrain/api';
import type { DocumentType } from '@/modules/document-types/api';
import type { FileCard, FormState } from '../types';
import { DEFAULT_AUTOFILL_FLOOR, PREVIEW_MAX_BYTES } from '../constants';
import { cardUid } from '../utils';

interface UseBatchUploadOptions {
  types: DocumentType[] | undefined;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
}

interface UseBatchUploadReturn {
  cards: FileCard[];
  batchFolderId: string;
  batchBranch: string;
  batchUploading: boolean;
  setBatchFolderId: (v: string) => void;
  setBatchBranch: (v: string) => void;
  buildCards: (files: File[]) => FileCard[];
  setCards: React.Dispatch<React.SetStateAction<FileCard[]>>;
  scanCard: (card: FileCard, currentCards: FileCard[]) => Promise<void>;
  rescanCard: (cardId: string) => void;
  updateCardField: (cardId: string, key: string, value: string) => void;
  updateCardDocType: (cardId: string, typeId: number | null) => void;
  revertCardField: (cardId: string, key: string) => void;
  toggleCardLock: (cardId: string, key: string) => void;
  removeCard: (cardId: string, onSoleFn?: (sole: FileCard) => void) => void;
  resetBatch: () => void;
  uploadAll: () => Promise<void>;
}

export function useBatchUpload({ types, fileInputRef }: UseBatchUploadOptions): UseBatchUploadReturn {
  const [cards, setCards] = useState<FileCard[]>([]);
  const [batchFolderId, setBatchFolderId] = useState('');
  const [batchBranch, setBatchBranch] = useState('');
  const [batchUploading, setBatchUploading] = useState(false);

  const buildCards = useCallback((files: File[]): FileCard[] => {
    const defaultTypeId = types?.[0]?.id ?? null;
    return files.map((f) => ({
      id: cardUid(),
      file: f,
      objectUrl: URL.createObjectURL(f),
      form: {},
      aiFilled: {},
      aiOriginalValues: {},
      manualEdits: {},
      lockedFields: {},
      docTypeId: defaultTypeId,
      status: f.size <= PREVIEW_MAX_BYTES
        ? { tag: 'scanning' as const }
        : { tag: 'idle' as const },
    }));
  }, [types]);

  const scanCard = useCallback(async (card: FileCard, _currentCards: FileCard[]) => {
    try {
      const data = await previewDocument(card.file);
      setCards((prev) => prev.map((c) => {
        if (c.id !== card.id) return c;

        // Auto-detect doc type from classification.
        let nextDocTypeId = c.docTypeId;
        const cls = data.classification;
        if (cls.doc_class && cls.doc_class !== 'Unknown' && types) {
          const normalised = cls.doc_class.toLowerCase().replace(/[\s_-]+/g, '');
          const match = types.find(
            (t) => t.name.toLowerCase().replace(/\s+/g, '') === normalised,
          );
          if (match) {
            const floor = match.autofill_floor ?? DEFAULT_AUTOFILL_FLOOR;
            if (cls.confidence >= floor) nextDocTypeId = match.id;
          }
        }

        // Apply AI-extracted fields respecting autofill floor.
        const docType = types?.find((t) => t.id === nextDocTypeId) ?? null;
        const nextForm: FormState = {};
        const nextConf: Record<string, number> = {};
        const nextOriginals: Record<string, string> = {};

        if (docType) {
          const floor = docType.autofill_floor ?? DEFAULT_AUTOFILL_FLOOR;
          const freetextFloor = Math.max(0, floor - 0.05);
          for (const f of docType.fields) {
            if (!f.ai_extract_from) continue;
            const ext = data.extraction[f.ai_extract_from as keyof Extraction];
            if (!ext?.value) continue;
            const threshold = f.ai_extract_from === 'address' ? freetextFloor : floor;
            if (ext.confidence < threshold) continue;
            nextForm[f.key] = ext.value;
            nextConf[f.key] = ext.confidence;
            nextOriginals[f.key] = ext.value;
          }
        }

        return {
          ...c,
          docTypeId: nextDocTypeId,
          form: nextForm,
          aiFilled: nextConf,
          aiOriginalValues: nextOriginals,
          status: { tag: 'ready' as const, preview: data },
        };
      }));
    } catch (err) {
      const msg = err instanceof HttpError ? err.message : 'AI preview failed';
      setCards((prev) => prev.map((c) =>
        c.id === card.id ? { ...c, status: { tag: 'scan_error' as const, message: msg } } : c,
      ));
    }
  }, [types]);

  const rescanCard = useCallback((cardId: string) => {
    setCards((prev) => {
      const next = prev.map((c) =>
        c.id === cardId && c.file.size <= PREVIEW_MAX_BYTES
          ? { ...c, status: { tag: 'scanning' as const } }
          : c,
      );
      const card = next.find((c) => c.id === cardId);
      if (card) void scanCard(card, next);
      return next;
    });
  }, [scanCard]);

  const updateCardField = useCallback((cardId: string, key: string, value: string) => {
    setCards((prev) => prev.map((c) => {
      if (c.id !== cardId) return c;
      if (c.lockedFields[key]) return c; // respect lock
      return {
        ...c,
        form: { ...c.form, [key]: value },
        manualEdits: { ...c.manualEdits, [key]: true as const },
      };
    }));
  }, []);

  const updateCardDocType = useCallback((cardId: string, typeId: number | null) => {
    setCards((prev) => prev.map((c) =>
      c.id === cardId
        ? { ...c, docTypeId: typeId, manualEdits: { ...c.manualEdits, __doc_type: true as const } }
        : c,
    ));
  }, []);

  const revertCardField = useCallback((cardId: string, key: string) => {
    setCards((prev) => prev.map((c) => {
      if (c.id !== cardId) return c;
      const original = c.aiOriginalValues[key];
      if (original == null) return c;
      const nextManual = { ...c.manualEdits };
      delete nextManual[key];
      return { ...c, form: { ...c.form, [key]: original }, manualEdits: nextManual };
    }));
  }, []);

  const toggleCardLock = useCallback((cardId: string, key: string) => {
    setCards((prev) => prev.map((c) => {
      if (c.id !== cardId) return c;
      const next = { ...c.lockedFields };
      if (next[key]) { delete next[key]; } else { next[key] = true; }
      return { ...c, lockedFields: next };
    }));
  }, []);

  const removeCard = useCallback((
    cardId: string,
    onSoleFn?: (sole: FileCard) => void,
  ) => {
    setCards((prev) => {
      const card = prev.find((c) => c.id === cardId);
      if (card) URL.revokeObjectURL(card.objectUrl);
      const next = prev.filter((c) => c.id !== cardId);
      if (next.length === 1 && onSoleFn) {
        const sole = next[0];
        if (sole) {
          URL.revokeObjectURL(sole.objectUrl);
          onSoleFn(sole);
          return [];
        }
      }
      return next;
    });
  }, []);

  const resetBatch = useCallback(() => {
    setCards((prev) => {
      for (const c of prev) URL.revokeObjectURL(c.objectUrl);
      return [];
    });
    setBatchFolderId('');
    setBatchBranch('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [fileInputRef]);

  const uploadAll = useCallback(async () => {
    if (batchUploading) return;
    setBatchUploading(true);

    const defaultType = types?.[0];

    const snapshot = await new Promise<FileCard[]>((resolve) => {
      setCards((c) => { resolve(c); return c; });
    });

    for (const card of snapshot) {
      if (card.status.tag === 'done') continue;
      const docType = types?.find((t) => t.id === card.docTypeId) ?? defaultType;
      if (!docType) continue;

      setCards((prev) => prev.map((c) =>
        c.id === card.id ? { ...c, status: { tag: 'uploading' as const } } : c,
      ));

      const fd = new FormData();
      fd.set('file', card.file);
      fd.set('doc_type', docType.name);
      if (batchFolderId) fd.set('folder_id', batchFolderId);
      if (batchBranch) fd.set('branch', batchBranch);
      fd.set('metadata_json', JSON.stringify(card.form));

      try {
        const result = await uploadDocumentWithKey(fd, crypto.randomUUID());
        analyzeDocument(result.id).catch(() => { /* background */ });
        setCards((prev) => prev.map((c) =>
          c.id === card.id
            ? { ...c, status: { tag: 'done' as const, uploadId: result.id, autoRouted: result.auto_routed ?? null } }
            : c,
        ));
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : 'Upload failed';
        setCards((prev) => prev.map((c) =>
          c.id === card.id ? { ...c, status: { tag: 'upload_error' as const, message: msg } } : c,
        ));
      }
    }

    setBatchUploading(false);
  }, [batchUploading, types, batchFolderId, batchBranch]);

  return {
    cards,
    batchFolderId,
    batchBranch,
    batchUploading,
    setBatchFolderId,
    setBatchBranch,
    buildCards,
    setCards,
    scanCard,
    rescanCard,
    updateCardField,
    updateCardDocType,
    revertCardField,
    toggleCardLock,
    removeCard,
    resetBatch,
    uploadAll,
  };
}
