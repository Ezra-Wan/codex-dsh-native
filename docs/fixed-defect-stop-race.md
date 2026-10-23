# 已修复缺陷档案：stop/close 与回合启动的竞态（2026-10-23）

> 本文档按用户要求留档：供其他 LLM 辅助审查或未来回归时参考。问题**已修复**（`src/bridge.mjs`），测试 `followup refuses while the session log shows fresh external writes` 曾稳定复现。

## 症状

`ds_stop` / `bridge.close()` 在**上一回合刚结束、followup 的新回合正在启动**的窗口内调用时，`close()` 永久挂起；进程无法退出（node --test 文件级 120s 超时，测试本体全过）。

## 根因（日志时序钉死）

带日志复现的关键序列：

```
95371 closing...
95371 close-call      ← stop() 调 runtime.close()，reject 的是【上一回合遗留的】reject 句柄（已失效）
95373 run-enter        ← 新回合 execute 此时才进入 run()，创建新的 pending promise
（挂死：entry.interrupt?.() 在 close 之前调用，彼时 race 尚未注册 → 落空；
  runtime.close 也已调过 → 新 run promise 无人能关）
```

代码路径：`stop()` 设 `entry.cancel = true` → 调 `entry.interrupt?.()`（此时 execute 还停在 `await this.save(record)`，race 的 rejecter 未注册，undefined 落空）→ `runtime.close()`（只拒绝旧句柄）→ `await entry.done`。execute 随后从 save 恢复，**cancel 检查点在 save 之前已过**，继续创建 run promise——从此两个打断手段都已错过。

## 修复（三个检查点盖住全部窗口）

1. `run()` 前、`save()` **之后**再查一次 `entry.cancel`（save 恢复即抛 'Interrupted before prompt'）；
2. `run()` 调用改为 `Promise.race([runPromise, interruptPromise])`，rejecter 存 `entry.interrupt`——已进入 run 后 stop 仍可打断；
3. `runPromise.catch(()=>{})` 预附着，防 race 输家被 transport close 拒绝时产生 unhandled rejection。

`stop()` 侧：`entry.cancel = true; entry.interrupt?.();` 后照旧 `runtime.close()` + `await entry.done`。

## 复现器（已验证修复前后行为差异）

见本档案同日会话；最小结构：start → finish → wait → followup（被活跃探测拒绝）→ followup（通过，新回合并停在 run 内无人 finish）→ `bridge.close()`。修复前挂起（"unsettled top-level await at close"），修复后正常退出。

## 审查要点（给辅助 LLM / 未来回归）

- 任何"外部关闭 + 内部异步推进"的资源生命周期改动，都要枚举 **cancel 标志读取点与异步恢复点之间**的每个窗口；
- 拒绝句柄（reject/callback）注册与调用之间的时序差是这类挂起的共同根源；
- `node --test` 文件级超时但测试全过 = after/清理钩子里有永不 settle 的 await，优先查 close/stop 链。
