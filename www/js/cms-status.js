/**
 * Unified CMS item status lifecycle: published | draft | trash
 */
export function normalizeCmsStatus(value) {
  var s = String(value == null ? '' : value).trim().toLowerCase();
  if (s === 'trash' || s === 'deleted') return 'trash';
  if (s === 'draft' || s === 'hidden') return 'draft';
  return 'published';
}

export function isPublishedCmsStatus(status) {
  return normalizeCmsStatus(status) === 'published';
}

export function isActiveCmsStatus(status) {
  var s = normalizeCmsStatus(status);
  return s === 'published' || s === 'draft';
}

export function isTrashCmsStatus(status) {
  return normalizeCmsStatus(status) === 'trash';
}

if (typeof window !== 'undefined') {
  window.CmsStatus = {
    normalize: normalizeCmsStatus,
    isPublished: isPublishedCmsStatus,
    isActive: isActiveCmsStatus,
    isTrash: isTrashCmsStatus,
  };
}
