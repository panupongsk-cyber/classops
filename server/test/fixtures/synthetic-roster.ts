// Synthetic registrar-style roster (invented people). Real roster files carry student personal
// data and never enter this repository. `tis620` re-encodes text the way the registrar exports it.

export function tis620(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code >= 0x0e01 && code <= 0x0e5b) bytes.push(0xa1 + (code - 0x0e01));
    else throw new Error(`not representable in TIS-620: ${ch}`);
  }
  return Buffer.from(bytes);
}

export const REGISTRAR_HEADER =
  "STUDENTCODE,PREFIXNAME,STUDENTNAME,STUDENTSURNAME,PREFIXNAMEENG,STUDENTNAMEENG,STUDENTSURNAMEENG,COURSECODE,COURSENAMEENG,SECTION,STUDENTEMAIL";

export interface SyntheticStudent {
  id: string;
  prefix: string;
  name: string;
  surname: string;
  prefixEn: string;
  nameEn: string;
  surnameEn: string;
  section: string;
  email: string;
}

export function registrarCsv(students: SyntheticStudent[], courseCode = "999001") {
  const lines = students.map((s) =>
    [s.id, s.prefix, s.name, s.surname, s.prefixEn, s.nameEn, s.surnameEn, courseCode, "Synthetic Course", s.section, s.email].join(","),
  );
  return `${[REGISTRAR_HEADER, ...lines].join("\r\n")}\r\n`;
}

export const STUDENTS: SyntheticStudent[] = [
  { id: "69000001", prefix: "นาย", name: "สมชาย", surname: "ทดสอบศรี", prefixEn: "Mr.", nameEn: "SOMCHAI", surnameEn: "THOTSOBSI", section: "1", email: "somchai.j@example.edu" },
  { id: "69000002", prefix: "นางสาว", name: "สมหญิง", surname: "รักเรียน", prefixEn: "Miss", nameEn: "SOMYING", surnameEn: "RAKRIAN", section: "1", email: "somying.r@example.edu" },
  { id: "69000003", prefix: "นาย", name: "มานะ", surname: "ขยัน", prefixEn: "Mr.", nameEn: "MANA", surnameEn: "KHAYAN", section: "1", email: "mana.k@example.edu" },
  { id: "69000004", prefix: "นางสาว", name: "ปิติ", surname: "ยินดี", prefixEn: "Miss", nameEn: "PITI", surnameEn: "YINDEE", section: "2", email: "piti.y@example.edu" },
];
