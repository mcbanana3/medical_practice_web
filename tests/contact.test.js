import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsPhone, validEmail } from '../shared/contact.js';
test('US phone formats normalize consistently', () => {
 for (const value of ['4323370555', '(432) 337-0555', '+1 432 337 0555', '14323370555']) assert.equal(normalizeUsPhone(value), '+14323370555');
});
test('foreign, invalid and appended phone content is rejected', () => {
 for (const value of ['+44 20 7946 0958', '+1 416 555 0123', '+1 242 365 1234', '1234567890', '4323370555 ext 2', '4323370555abc', '', '432337055555']) assert.equal(normalizeUsPhone(value), '', value);
});
test('email accepts ordinary addresses and rejects malformed domains and local parts', () => {
 for (const value of ['patient@example.com', ' name+visit@example.co.uk ', "o'brien@example.com"]) assert.equal(validEmail(value), true, value);
 for (const value of ['a@b', 'a..b@example.com', '.a@example.com', 'a@-example.com', 'a@example..com', 'a b@example.com', 'a@example.com\nBcc:other@example.com', 'a'.repeat(65)+'@example.com']) assert.equal(validEmail(value), false, value);
});
