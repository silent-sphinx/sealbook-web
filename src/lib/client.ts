export { importBatches, paddedLength } from "./vaultImport";
export {
  ApiError,
  REQUEST_TIMEOUT_MS,
  apiRoot,
  normalizeServer,
  RequestTimeoutError,
  setProxyLoopback,
  ServerUnreachableError,
} from "./transport";
export {
  ATTACHMENT_CHUNK_SIZE,
  MAX_ATTACHMENT_SIZE,
  AttachmentIntegrityError,
  deleteAttachment,
  downloadAttachment,
  loadAttachment,
  sweepOrphanedAttachments,
  uploadAttachment,
} from "./attachments";
export {
  deleteAddressBook,
  deleteContact,
  ensureDefaultAddressBook,
  putAddressBook,
  putContact,
} from "./addressBookApi";
export {
  CALENDAR_CONTENT_TYPE,
  CALENDAR_EVENT_CONTENT_TYPE,
  deleteCalendar,
  deleteCalendarEvent,
  ensureDefaultCalendar,
  putCalendar,
  putCalendarEvent,
} from "./calendarApi";
export {
  deleteNote,
  deleteNotebook,
  ensureDefaultNotebook,
  newNoteId,
  putNote,
  putNotebook,
} from "./noteApi";
export {
  deleteBookmark,
  deleteBookmarkCollection,
  ensureDefaultBookmarkCollection,
  newBookmarkId,
  putBookmark,
  putBookmarkCollection,
} from "./bookmarkApi";
export {
  deleteTask,
  deleteTaskList,
  ensureDefaultTaskList,
  newTaskId,
  putTask,
  putTaskList,
} from "./taskApi";
export { ManifestError, RosterTooOldError, syncRoster, verifiedRoster } from "./roster";

export type { Session } from "./clientCore";
export { refreshCollectionKey } from "./clientCore";

export type { RegisterResult } from "./clientAuth";
export {
  changePassword,
  changeUsername,
  completeRecoveryRotation,
  deleteAccount,
  loginAccount,
  recoverAccount,
  registerAccount,
  revokeSession,
  rotatePhrase,
  rotateVault,
} from "./clientAuth";

export type { DeviceSummary, PairPreview } from "./clientPairing";
export {
  listDevices,
  pairApprove,
  pairJoin,
  pairPreview,
  pairPoll,
  revokeDevice,
} from "./clientPairing";

export type { VaultExport, VaultImportResult, VaultListing, VaultProgress } from "./clientVault";
export {
  exportVault,
  importVault,
  listVault,
  putAccountSettings,
  putCalendarEvents,
  putSealed,
} from "./clientVault";

export { rotateAuthenticated } from "./clientRotation";
