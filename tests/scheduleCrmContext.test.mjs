import test from 'node:test';
import assert from 'node:assert/strict';
import { matchScheduleCrmPatient, normalizeSchedulePhone } from '../src/pages/scheduleCrmContext.ts';

test('normalizeSchedulePhone keeps only digits', () => {
  assert.equal(normalizeSchedulePhone('+7 (701) 123-45-67'), '77011234567');
  assert.equal(normalizeSchedulePhone('8 701 123 45 67'), '87011234567');
  assert.equal(normalizeSchedulePhone(undefined), '');
});

test('CRM contact match has priority over phone match', () => {
  const patients = [
    { id: 'patient-contact', name: 'Contact match', phone: '+7 700 000 00 01', crm_contact_id: 'contact-1' },
    { id: 'patient-phone', name: 'Phone match', phone: '+7 701 111 22 33', crm_contact_id: 'contact-2' },
  ];
  const matched = matchScheduleCrmPatient(patients, { contactId: 'contact-1', phone: '+7 701 111 22 33' });
  assert.equal(matched?.id, 'patient-contact');
});

test('normalized phone is used when crm_contact_id is not matched', () => {
  const patients = [{ id: 'patient-1', name: 'Patient', phone: '+7 (701) 555-44-33', crm_contact_id: null }];
  const matched = matchScheduleCrmPatient(patients, { contactId: 'missing-contact', phone: '77015554433' });
  assert.equal(matched?.id, 'patient-1');
});

test('context never creates an artificial frontend patient', () => {
  const matched = matchScheduleCrmPatient([], { contactId: 'contact-1', phone: '+7 701 555 44 33', name: 'CRM Contact' });
  assert.equal(matched, undefined);
});

test('missing context or phone returns no patient match', () => {
  const patients = [{ id: 'patient-1', name: 'Patient', phone: '+7 701 555 44 33' }];
  assert.equal(matchScheduleCrmPatient(patients), undefined);
  assert.equal(matchScheduleCrmPatient(patients, { name: 'Only name' }), undefined);
});
