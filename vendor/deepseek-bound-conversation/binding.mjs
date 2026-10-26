// Extracted from @deepseek-ai/dsh-client-ui-conversation@0.2.1-rc.2 lib/client.js.
// Copyright (c) 2026 DeepSeek. MIT; see LICENSE and SOURCE.md.
// Class body preserved; only export form and store import names adapted.
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
export class BoundConversation {
      assembler;
      snapshot;
      openTurn;
      viewStore;
      targetSources = /* @__PURE__ */ new Map();
      revision = -1;
      frame;
      disposeFeed = () => {
      };
      constructor(feed, assembler) {
        this.assembler = assembler;
        this.viewStore = assembler;
        this.snapshot = createSnapshotStore(this.currentSnapshot());
        this.openTurn = createSnapshotStore(assembler.openTurn());
        this.replace(feed.getSnapshot());
        this.disposeFeed = feed.subscribe(() => {
          this.accept(feed.getSnapshot());
        });
      }
      target(target) {
        let source = this.targetSources.get(target);
        if (source === void 0) {
          const views = this.viewStore;
          source = {
            getSnapshot: () => views.get(target),
            subscribe: (listener) => {
              const unsubscribe = this.snapshot.subscribe(listener);
              this.activate(target);
              return unsubscribe;
            }
          };
          this.targetSources.set(target, source);
        }
        return source;
      }
      activate(target) {
        if (this.assembler.activateTarget(target)) this.snapshot.set(this.currentSnapshot());
        this.openTurn.set(this.assembler.openTurn());
      }
      rebuild() {
        this.publish(this.assembler.rebuildRegistry());
      }
      dispose() {
        this.cancelFrame();
        this.disposeFeed();
      }
      replace(window2) {
        this.revision = window2.revision;
        this.publish(this.assembler.replaceWindow(window2.entries, window2.hasMore));
      }
      accept(window2) {
        if (window2.revision === this.revision) return;
        if (window2.revision !== this.revision + 1 || window2.change.kind === "replace") {
          this.replace(window2);
          return;
        }
        this.revision = window2.revision;
        switch (window2.change.kind) {
          case "prepend":
            this.publish(this.assembler.prepend(window2.change.entries, window2.hasMore));
            return;
          case "append": {
            let publication = "none";
            for (const event of window2.change.entries) {
              const next = this.assembler.append(event);
              if (next === "immediate" || publication === "none") publication = next;
            }
            this.publish(publication);
            return;
          }
          case "settle-assistant":
            this.publish(this.assembler.settleAssistant(window2.change.attemptId, window2.change.entry));
            return;
        }
      }
      publish(publication) {
        if (publication === "none") return;
        if (publication === "animation-frame" && typeof requestAnimationFrame === "function") {
          if (this.frame !== void 0) return;
          this.frame = requestAnimationFrame(() => {
            this.frame = requestAnimationFrame(() => {
              this.frame = requestAnimationFrame(() => {
                this.frame = void 0;
                this.flush();
              });
            });
          });
          return;
        }
        this.cancelFrame();
        this.flush();
      }
      cancelFrame() {
        if (this.frame !== void 0 && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.frame);
        this.frame = void 0;
      }
      flush() {
        if (this.assembler.flush()) this.snapshot.set(this.currentSnapshot());
        this.openTurn.set(this.assembler.openTurn());
      }
      currentSnapshot() {
        return {
          views: this.viewStore,
          activeTargets: this.assembler.activityTargets()
        };
      }
    }
