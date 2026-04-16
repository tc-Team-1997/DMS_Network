const I18N = {
  en: {
    title_dashboard: "Executive Dashboard",
    title_capture: "Capture",
    title_indexing: "Indexing",
    title_ai: "AI Processing",
    title_repository: "Repository",
    title_search: "Advanced Search",
    title_workflow: "Workflow",
    title_integration: "Integration Hub",
    kpi_total: "Total Documents",
    kpi_ocr: "OCR Processed",
    kpi_pending: "Pending Approvals",
    kpi_expiring: "Expiring (30d)",
    btn_upload: "Quick Upload",
    btn_search: "Search",
    btn_submit: "Submit",
    btn_capture: "Upload",
    nav_overview: "Overview",
    nav_lifecycle: "Lifecycle",
    nav_discovery: "Discovery",
    nav_operations: "Operations",
    lang_label: "Language",
    placeholder_search: "Search documents, customers, OCR text…",
  },
  ar: {
    title_dashboard: "لوحة التحكم التنفيذية",
    title_capture: "الالتقاط",
    title_indexing: "الفهرسة",
    title_ai: "المعالجة بالذكاء الاصطناعي",
    title_repository: "المستودع",
    title_search: "البحث المتقدم",
    title_workflow: "سير العمل",
    title_integration: "مركز التكامل",
    kpi_total: "إجمالي المستندات",
    kpi_ocr: "تمت معالجتها",
    kpi_pending: "الموافقات المعلقة",
    kpi_expiring: "تنتهي خلال ٣٠ يومًا",
    btn_upload: "رفع سريع",
    btn_search: "بحث",
    btn_submit: "إرسال",
    btn_capture: "رفع",
    nav_overview: "نظرة عامة",
    nav_lifecycle: "دورة الحياة",
    nav_discovery: "الاكتشاف",
    nav_operations: "العمليات",
    lang_label: "اللغة",
    placeholder_search: "ابحث في المستندات والعملاء ونصوص OCR…",
  },
};

const LANG_KEY = "nbe.dms.lang";

export function getLang() {
  return localStorage.getItem(LANG_KEY) || (navigator.language?.startsWith("ar") ? "ar" : "en");
}

export function setLang(lang) {
  localStorage.setItem(LANG_KEY, lang);
  applyLang();
}

export function t(key) {
  const lang = getLang();
  return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
}

export function applyLang() {
  const lang = getLang();
  const rtl = lang === "ar";
  document.documentElement.lang = lang;
  document.documentElement.dir = rtl ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
}

if (typeof window !== "undefined") {
  window.NBE_I18N = { getLang, setLang, t, applyLang };
  document.addEventListener("DOMContentLoaded", applyLang);
}
