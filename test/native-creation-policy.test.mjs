import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { Context } from '@deepseek-ai/cordis';
import { nativeCreationPolicyCss } from '../ui/native-creation-policy.mjs';

test('creation-button policy follows the real native locale registry and scopes dynamic workspace labels without empty substring selectors', async()=>{
  let factory;
  const source=await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-locale/client')),'utf8');
  runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{factory=entry.factory;}}},navigator:{languages:['en'],language:'en'}});
  const require=createRequire(import.meta.url);
  // No React rendering in this test: only the installed LocaleRuntime runs.
  const {LocaleRuntime}=factory(id=>id==='@deepseek-ai/dsh-client-ui-primitives'?{}:require(id));
  const ctx=new Context();
  try {
    const locale=new LocaleRuntime(ctx);
    locale.register('sidebar','en',{'session.new.label':'New session'});
    locale.register('workspace','en',{'workspace.add':'Add workspace','actions.newSession.aria':'New "session" in {name}'});
    locale.register('sidebar','zh',{'session.new.label':'新建会话'});
    locale.register('workspace','zh',{'workspace.add':'添加工作区','actions.newSession.aria':'在{name}中新建会话'});
    const en=nativeCreationPolicyCss(locale);
    assert.match(en,/button\[aria-label="New session"\]/);
    assert.ok(en.includes('aria-label^="New \\"session\\" in "'));
    assert.ok(!en.includes('[aria-label$=""]'),'an empty CSS substring selector would hide no row buttons');
    locale.setLocale('zh');
    const zh=nativeCreationPolicyCss(locale);
    assert.ok(zh.includes('button[aria-label="添加工作区"]'));
    assert.ok(zh.includes('[aria-label^="在"][aria-label$="中新建会话"]'));
    assert.ok(!zh.includes('New session'),'stale language labels must not govern native buttons');
  } finally { await ctx.fiber.dispose(); }
});
