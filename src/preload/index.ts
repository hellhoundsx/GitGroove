import { contextBridge, ipcRenderer } from 'electron';
import type { GitApi } from '@shared/types';

const call =
  <T>(channel: string) =>
  (...args: unknown[]): Promise<T> =>
    ipcRenderer.invoke(channel, ...args);

const api: GitApi = {
  checkGit: call('repo:checkGit'),
  openRepoDialog: call('repo:openDialog'),
  loadRepo: call('repo:load'),
  getStatus: call('repo:status'),
  getCommitFiles: call('commit:files'),
  getCommitFileDiff: call('commit:fileDiff'),
  getWorkdirFileDiff: call('workdir:fileDiff'),
  stage: call('workdir:stage'),
  unstage: call('workdir:unstage'),
  stageAll: call('workdir:stageAll'),
  unstageAll: call('workdir:unstageAll'),
  discard: call('workdir:discard'),
  applyPatch: call('workdir:applyPatch'),
  commit: call('workdir:commit'),
  checkout: call('ref:checkout'),
  createBranch: call('ref:createBranch'),
  deleteBranch: call('ref:deleteBranch'),
  renameBranch: call('ref:renameBranch'),
  deleteRemoteBranch: call('ref:deleteRemoteBranch'),
  merge: call('ref:merge'),
  rebase: call('ref:rebase'),
  cherryPick: call('ref:cherryPick'),
  revert: call('ref:revert'),
  reset: call('ref:reset'),
  abortOperation: call('ref:abortOperation'),
  createTag: call('ref:createTag'),
  deleteTag: call('ref:deleteTag'),
  remoteAdd: call('remote:add'),
  remoteRemove: call('remote:remove'),
  remoteSetUrl: call('remote:setUrl'),
  remoteRename: call('remote:rename'),
  fetch: call('remote:fetch'),
  pull: call('remote:pull'),
  push: call('remote:push'),
  stashSave: call('stash:save'),
  stashApply: call('stash:apply'),
  stashPop: call('stash:pop'),
  stashDrop: call('stash:drop'),
};

contextBridge.exposeInMainWorld('api', api);
contextBridge.exposeInMainWorld('platform', process.platform);
