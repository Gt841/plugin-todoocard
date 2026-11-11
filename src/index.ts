import { Plugin } from "siyuan";

export default class TodoocardPlugin extends Plugin {
  onload() {
    this.addTopBar({
      icon: `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M14.88 16.29L13 18.17v-3.76l1.88 1.88M13 5.83l1.88 1.88L13 9.59V5.83m4.71 1.88L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29z"/></svg>`,
      title: "土豆片",
      position: "right",
      callback: () => { /* wired in Task 10 */ },
    });
  }
}