import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { DesktopBridge } from './bridge.js';
const bridge: DesktopBridge = {
  getSchedules: () => ipcRenderer.invoke('schedules:list'),
  setSchedule: (projectId, config) => ipcRenderer.invoke('schedules:set', projectId, config),
  request: (method, params) => ipcRenderer.invoke('aiden:request', method, params),
  chooseProjectFolder: () => ipcRenderer.invoke('aiden:chooseProjectFolder'),
  chooseContext: () => ipcRenderer.invoke('aiden:chooseContext'),
  openExternal: (url) => ipcRenderer.invoke('aiden:openExternal', url),
  saveExport: (params) => ipcRenderer.invoke('aiden:export', params),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getUpdateStatus: () => ipcRenderer.invoke('updates:get-status'),
  getUpdatePreferences: () => ipcRenderer.invoke('updates:get-preferences'),
  setUpdatePreferences: (preferences) => ipcRenderer.invoke('updates:set-preferences', preferences),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateStatus: (callback) => {
    /** Forward only the event payload; Electron event objects stay in the isolated preload. */
    const listener = (
      _event: IpcRendererEvent,
      status: Parameters<Parameters<DesktopBridge['onUpdateStatus']>[0]>[0],
    ) => callback(status);
    ipcRenderer.on('updates:status', listener);
    return () => ipcRenderer.removeListener('updates:status', listener);
  },
  onEvent: (callback) => {
    /** Forward only the event payload; Electron event objects stay in the isolated preload. */
    const listener = (
      _event: IpcRendererEvent,
      data: Parameters<Parameters<DesktopBridge['onEvent']>[0]>[0],
    ) => callback(data);
    ipcRenderer.on('aiden:event', listener);
    return () => ipcRenderer.removeListener('aiden:event', listener);
  },
};
contextBridge.exposeInMainWorld('aiden', bridge);
