'use strict';
// Calendar-date schedules for recurring commitments (BT-008). Dates are plain YYYY-MM-DD in UTC,
// never timestamps, so a due date is the same day for every viewer. Month and year steps are
// always computed FROM THE ANCHOR with the day clamped to the month's length, so a schedule on
// the 31st is on the 30th in April and the 28th/29th in February but returns to the 31st in May —
// it never drifts permanently. A yearly schedule on 29 February falls on 28 February in
// non-leap years and on the 29th in leap years.
const { badRequest } = require('./http');
const fields = require('./fields');

const FREQS = Object.freeze(['weekly', 'monthly', 'yearly']);
const MAX_OCCURRENCES = 1000;

const parse = (d) => { const [y, m, day] = d.split('-').map(Number); return { y, m: m - 1, d: day }; };
const pad = (n) => String(n).padStart(2, '0');
const fmt = (y, m0, d) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const daysInMonth = (y, m0) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

function addDays(iso, n) {
  const { y, m, d } = parse(iso);
  const dt = new Date(Date.UTC(y, m, d + n));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
}

function addMonthsClamped(iso, months, dayOfMonth) {
  const { y, m } = parse(iso);
  const total = y * 12 + m + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  return fmt(ny, nm, Math.min(dayOfMonth, daysInMonth(ny, nm)));
}

const daysBetween = (a, b) => {
  const pa = parse(a); const pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m, pb.d) - Date.UTC(pa.y, pa.m, pa.d)) / 86400000);
};

function validateSchedule(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw badRequest('A schedule is required.', 'invalid_schedule');
  fields.onlyKeys(input, ['freq', 'interval', 'startDate', 'endDate']);
  const freq = fields.oneOf(input.freq, FREQS, 'Frequency');
  const interval = input.interval === undefined ? 1 : input.interval;
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) throw badRequest('Interval must be a whole number from 1 to 52.', 'invalid_schedule');
  const startDate = fields.date(input.startDate, 'Start date', { required: true });
  const endDate = fields.date(input.endDate, 'End date');
  if (endDate && endDate < startDate) throw badRequest('The end date is before the start date.', 'invalid_schedule');
  return { freq, interval, startDate, endDate: endDate || null, dayOfMonth: parse(startDate).d };
}

// Occurrence dates within [from, to] (inclusive), in order, bounded.
function occurrences(schedule, from, to) {
  const out = [];
  const last = schedule.endDate && schedule.endDate < to ? schedule.endDate : to;
  if (last < schedule.startDate) return out;
  for (let k = 0; out.length < MAX_OCCURRENCES; k += 1) {
    let date;
    if (schedule.freq === 'weekly') date = addDays(schedule.startDate, 7 * schedule.interval * k);
    else if (schedule.freq === 'monthly') date = addMonthsClamped(schedule.startDate, schedule.interval * k, schedule.dayOfMonth);
    else date = addMonthsClamped(schedule.startDate, 12 * schedule.interval * k, schedule.dayOfMonth);
    if (date > last) break;
    if (date >= from) out.push(date);
    if (k > 100000) break;
  }
  return out;
}

module.exports = { FREQS, validateSchedule, occurrences, addDays, addMonthsClamped, daysBetween, daysInMonth };
