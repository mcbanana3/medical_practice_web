import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export function normalizeUsPhone(input) {
  const value = String(input || '').trim();
  if (!value || value.length > 32 || !/^\+?[\d(). -]+$/.test(value)) return '';
  const digits = value.replace(/\D/g, '');
  if (!(digits.length === 10 || digits.length === 11 && digits[0] === '1')) return '';
  const phone = parsePhoneNumberFromString(value, 'US');
  return phone?.country === 'US' && phone.isValid() && !phone.ext ? phone.number : '';
}

export function validEmail(input) {
  const value = String(input || '').trim();
  if (value.length > 254 || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every(label => label.length <= 63 && /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label)) && /^[a-zA-Z]{2,63}$/.test(labels.at(-1));
}
