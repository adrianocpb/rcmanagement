/** Tipos de arquivo aceitos nos anexos (solicitações e comentários das tarefas). */

/** Tipos aceitos (extensão → tipo MIME servido). SVG/HTML ficam de fora por segurança. */
export const ALLOWED_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};
/** Tipos exibidos no navegador; os demais são baixados. */
export const INLINE = /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/(mp4|webm|quicktime))$/;
