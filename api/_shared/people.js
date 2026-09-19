'use strict';
// Typed, stable person references used by every people selector and financial record:
//   member:<memberId>     an active workspace member
//   contact:<contactId>   a shared contact of the workspace (no login, no access)
//   pcontact:<contactId>  one person's private contact — usable only on their private records
//
// A reference records WHO was involved (paid by, responsible, participant). It never grants
// access to the application or authority over anyone's account.
const { badRequest } = require('./http');
const { isSafeId } = require('./ids');
const model = require('./workspace-model');

const REF_RE = /^(member|contact|pcontact):([A-Za-z0-9_-]{1,64})$/;

function parseRef(ref) {
  const m = typeof ref === 'string' ? REF_RE.exec(ref) : null;
  if (!m || !isSafeId(m[2])) throw badRequest('Person reference is not valid.', 'invalid_person');
  return { type: m[1], id: m[2] };
}

// Validates that a reference exists and may be used on a record of the given visibility.
function requireRef(ref, { doc, user, visibility }) {
  if (ref === undefined || ref === null || ref === '') return null;
  const { type, id } = parseRef(ref);
  if (type === 'member') {
    const m = model.findMember(doc, id);
    if (!m || m.status !== 'active') throw badRequest('That member is not active in this workspace.', 'invalid_person');
  } else if (type === 'contact') {
    // BT-009-15: a contact who has joined as a member cannot be newly chosen as "responsible"
    // either — going forward that relationship is the member they are now. This only ever runs
    // when a value is being explicitly (re)submitted (every caller checks `!== undefined` first),
    // so a record that already names the contact and is not touching this field is never
    // re-validated against it, exactly like every other field here.
    const c = (doc.contacts || []).find((x) => x.id === id && !x.deletedAt && !x.joinedMemberId);
    if (!c) throw badRequest('That contact does not exist in this workspace.', 'invalid_person');
  } else {
    if (visibility !== 'private') throw badRequest('Private contacts can only be used on your private records. Use a shared contact instead.', 'private_contact_on_shared');
    const c = ((user && user.contacts) || []).find((x) => x.id === id && !x.deletedAt);
    if (!c) throw badRequest('That private contact does not exist.', 'invalid_person');
  }
  return ref;
}

// Display label for a reference, from the viewer's point of view. Another person's private
// contact is never resolved — it shows only as "Private contact".
function labelFor(ref, { doc, user }) {
  if (!ref) return null;
  let parsed;
  try { parsed = parseRef(ref); } catch { return { ref, label: 'Unknown', type: 'unknown' }; }
  if (parsed.type === 'member') {
    const m = model.findMember(doc, parsed.id);
    return { ref, label: m ? (m.name || 'Member') : 'Former member', type: 'member' };
  }
  if (parsed.type === 'contact') {
    const c = (doc.contacts || []).find((x) => x.id === parsed.id);
    return { ref, label: c ? c.name : 'Removed contact', type: 'contact' };
  }
  const own = ((user && user.contacts) || []).find((x) => x.id === parsed.id);
  return { ref, label: own ? own.name : 'Private contact', type: 'private-contact' };
}

module.exports = { parseRef, requireRef, labelFor };
