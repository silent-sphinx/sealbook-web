export { importBatches } from "./vaultImport";
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
  deleteCalendarEvents,
  ensureDefaultCalendar,
  putCalendar,
  putCalendarEvent,
  updateCalendarEvents,
} from "./calendarApi";
export {
  deleteNote,
  deleteNotes,
  deleteNotebook,
  ensureDefaultNotebook,
  newNoteId,
  putNote,
  putNotes,
  putNotebook,
  saveNote,
} from "./noteApi";
export { vaultObject } from "./outbox";
export {
  deleteBookmark,
  deleteBookmarkCollection,
  deleteBookmarks,
  ensureDefaultBookmarkCollection,
  newBookmarkId,
  putBookmark,
  putBookmarkCollection,
  putBookmarks,
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
  rotateOwed,
  deleteAccount,
  loginAccount,
  recoverAccount,
  registerAccount,
  revokeSession,
  rotatePhrase,
  rotateVault,
} from "./clientAuth";

export type {
  DeviceSummary,
  JoinPairing,
  PairJoinStep,
  PairPreview,
  PairPreviewStep,
  PairResponse,
} from "./clientPairing";
export {
  listDevices,
  pairApprove,
  pairCancel,
  pairJoin,
  pairJoinStep,
  pairPreviewStep,
  pairRespond,
  revokeDevices,
} from "./clientPairing";

export type { VaultExport, VaultImportResult, VaultListing, VaultProgress } from "./clientVault";
export {
  exportVault,
  importVault,
  listVault,
  listVaultOrLocal,
  listingFrom,
  putCalendarEvents,
} from "./clientVault";
export type { FlushReport } from "./clientFlush";
export {
  catchUp,
  flushOutbox,
  putAccountSettings,
  putSealed,
  putSealedMany,
  RefusedWrites,
} from "./clientFlush";
export type { SealedWrite } from "./clientFlush";

export { rotateAuthenticated } from "./clientRotation";
export {
  browserOs,
  browserPlatform,
  DEVICE_LABEL_CONTENT_TYPE,
  ensureDeviceLabel,
  deviceEntries,
  MAX_DEVICE_NAME_CHARS,
  removeStaleDeviceLabels,
  renameDevice,
  thisDeviceName,
  type DeviceEntry,
  type DeviceLabel,
} from "./devices";
