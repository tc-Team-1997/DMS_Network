// On-device MRZ (Machine-Readable Zone) parser.
// Extracts fields from the 2 × 44-char TD3 passport line, or 3 × 30 TD1 ID card lines.
// Runs entirely offline — pair with vision-camera-ocr's on-device recognizer.

const TD3 = /^([A-Z<]{2})([A-Z<0-9]{3})([A-Z<]{39})$/;
const TD3_LINE2 = /^([A-Z0-9<]{9})([0-9])([A-Z<]{3})(\d{6})(\d)([MF<])(\d{6})(\d)([A-Z0-9<]{14})([0-9<])([0-9])$/;

function clean(s) {
  return (s || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9<]/g, "");
}

// Check digit algorithm per ICAO 9303.
function checkDigit(input) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const v = c === "<" ? 0 : /[0-9]/.test(c) ? +c : c.charCodeAt(0) - 55;
    sum += v * weights[i % 3];
  }
  return sum % 10;
}

function yymmddToISO(s) {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = +s.slice(0, 2), mm = s.slice(2, 4), dd = s.slice(4, 6);
  // MRZ convention: 00-29 → 2000-2029, 30-99 → 1930-1999.
  const yyyy = yy <= 29 ? 2000 + yy : 1900 + yy;
  return `${yyyy}-${mm}-${dd}`;
}

export function parseMrz(raw) {
  const lines = (raw || "").split(/\r?\n/).map(clean).filter((l) => l.length >= 30);
  if (lines.length < 2) return null;

  // TD3 (passport): 2 lines of 44
  const td3 = lines.filter((l) => l.length === 44);
  if (td3.length >= 2) {
    const [l1, l2] = td3;
    const nameRaw = l1.slice(5);
    const [surname, givenRaw] = nameRaw.split("<<");
    const m = l2.match(TD3_LINE2);
    if (!m) return null;
    const [, passport, cd1, nat, dob, cd2, sex, exp, cd3, personal, cd4, cdComposite] = m;
    const checks = {
      passport: checkDigit(passport) === +cd1,
      dob:      checkDigit(dob) === +cd2,
      expiry:   checkDigit(exp) === +cd3,
    };
    return {
      kind: "TD3",
      surname: (surname || "").replace(/</g, " ").trim(),
      given:   (givenRaw || "").replace(/</g, " ").trim(),
      passport_no: passport.replace(/</g, ""),
      nationality: nat,
      dob: yymmddToISO(dob),
      sex: sex === "<" ? null : sex,
      expiry_date: yymmddToISO(exp),
      personal_no: personal.replace(/</g, ""),
      valid: Object.values(checks).every(Boolean),
      checks,
    };
  }

  // TD1 (national ID): 3 × 30 — trimmed version.
  if (lines.length >= 3 && lines[0].length === 30) {
    const [l1, l2, l3] = lines;
    const documentNo = l1.slice(5, 14);
    const dob = l2.slice(0, 6);
    const expiry = l2.slice(8, 14);
    return {
      kind: "TD1",
      document_no: documentNo.replace(/</g, ""),
      dob: yymmddToISO(dob),
      expiry_date: yymmddToISO(expiry),
      name: l3.replace(/</g, " ").trim(),
      valid: true,
    };
  }
  return null;
}
