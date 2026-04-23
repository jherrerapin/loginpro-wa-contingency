import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const MODEL = 'gpt-5.4-mini-2026-03-17';

function classifyFromText(text = '') {
  const n = String(text || '').toLowerCase();
  if (!n.trim()) return { classification: 'UNREADABLE', confidence: 0.2, evidence: '' };
  if (/hoja de vida|curriculum|experiencia laboral|perfil profesional/.test(n)) return { classification: 'CV_VALID', confidence: 0.9, evidence: 'texto_cv' };
  if (/cedula|c[eé]dula|identidad|dni|passport|pasaporte/.test(n)) return { classification: 'ID_DOC', confidence: 0.9, evidence: 'texto_id' };
  return { classification: 'OTHER', confidence: 0.65, evidence: 'texto_otro' };
}

export async function analyzeAttachment({ buffer, mimeType = '', filename = '' } = {}) {
  const mime = String(mimeType || '').toLowerCase();
  const name = String(filename || '').toLowerCase();

  if (mime.startsWith('image/')) {
    return { classification: 'CV_IMAGE_ONLY', confidence: 0.75, evidence: 'image_input', model: MODEL };
  }

  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    const parsed = await pdfParse(buffer).catch(() => ({ text: '' }));
    const text = String(parsed?.text || '').slice(0, 5000);
    return { ...classifyFromText(text), extractedText: text, model: MODEL };
  }

  if (mime.includes('word') || name.endsWith('.docx') || name.endsWith('.doc')) {
    const parsed = await mammoth.extractRawText({ buffer }).catch(() => ({ value: '' }));
    const text = String(parsed?.value || '').slice(0, 5000);
    return { ...classifyFromText(text), extractedText: text, model: MODEL };
  }

  return { classification: 'OTHER', confidence: 0.5, evidence: 'unsupported_format', model: MODEL };
}
