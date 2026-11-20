import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Lang } from '../../shared/i18n.ts';
// M7-7: từ điển hệ cũ + câu mới của hệ mới (i18nNew.ts)
import { translateAll as translateText } from './i18nNew.ts';

/**
 * Language switch (Vietnamese is the source language). In English mode a small translator walks the page and swaps
 * every known piece of interface text (text, placeholder, tooltip) for its English version, and keeps doing so as
 * React re-renders. Switching back restores the original text. Data (names, Drop-list values, comments) is never
 * touched: only text found in the dictionary changes, and anything marked data-no-i18n is skipped.
 */
interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** For text that is built in code (alerts, confirm boxes, error messages). */
  t: (vi: string) => string;
}

const Ctx = createContext<LangCtx>({ lang: 'vi', setLang: () => undefined, t: (s) => s });
export const useLang = (): LangCtx => useContext(Ctx);

const STORAGE_KEY = 'ta_lang';
const ATTRS = ['placeholder', 'title', 'aria-label'] as const;
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);

const readLang = (): Lang => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'vi';
  } catch {
    return 'vi';
  }
};

function skipped(node: Node): boolean {
  for (let el: Node | null = node; el; el = el.parentNode) {
    if (el.nodeType === 1) {
      const e = el as Element;
      if (SKIP_TAGS.has(e.tagName) || e.hasAttribute('data-no-i18n')) return true;
    }
  }
  return false;
}

/** Starts the translator; returns a function that stops it and puts the Vietnamese text back. */
function startTranslator(): () => void {
  const textOrig = new Map<Text, string>();
  const attrOrig = new Map<Element, Record<string, string>>();

  const doText = (n: Text) => {
    const cur = n.data;
    const prev = textOrig.get(n);
    if (prev !== undefined && translateText(prev) === cur) return; // still our own translation
    if (skipped(n)) return;
    const en = translateText(cur);
    if (en !== cur) {
      textOrig.set(n, cur);
      n.data = en;
    }
  };
  const doAttrs = (e: Element) => {
    if (skipped(e)) return;
    for (const a of ATTRS) {
      const cur = e.getAttribute(a);
      if (!cur) continue;
      const rec = attrOrig.get(e) || {};
      if (rec[a] !== undefined && translateText(rec[a]) === cur) continue;
      const en = translateText(cur);
      if (en !== cur) {
        rec[a] = cur;
        attrOrig.set(e, rec);
        e.setAttribute(a, en);
      }
    }
  };
  const walk = (root: Node) => {
    if (root.nodeType === 3) {
      doText(root as Text);
      return;
    }
    if (root.nodeType !== 1) return;
    const e = root as Element;
    if (SKIP_TAGS.has(e.tagName)) return;
    doAttrs(e);
    const tw = document.createTreeWalker(e, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === 3) doText(n as Text);
      else doAttrs(n as Element);
    }
  };

  walk(document.body);
  const prevTitle = document.title;
  document.title = 'THE SUPRA - RECRUITMENT — Recruitment Management & Tracking';

  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach((n) => walk(n));
      else if (m.type === 'characterData') doText(m.target as Text);
      else if (m.type === 'attributes') doAttrs(m.target as Element);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });

  return () => {
    obs.disconnect();
    textOrig.forEach((vi, n) => {
      if (n.isConnected) n.data = vi;
    });
    attrOrig.forEach((rec, e) => {
      if (!e.isConnected) return;
      for (const a of Object.keys(rec)) e.setAttribute(a, rec[a]);
    });
    document.title = prevTitle;
  };
}

export const LangProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(readLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* the choice just is not remembered */
    }
  }, []);

  useEffect(() => {
    if (lang !== 'en') return undefined;
    return startTranslator();
  }, [lang]);

  const value = useMemo<LangCtx>(() => ({ lang, setLang, t: (s) => (lang === 'en' ? translateText(s) : s) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

/** Small VI | EN switch. */
export const LangSwitch: React.FC<{ className?: string }> = ({ className }) => {
  const { lang, setLang } = useLang();
  return (
    <span className={`inline-flex rounded-md border border-slate-200 overflow-hidden text-[11px] font-bold ${className || ''}`} data-no-i18n>
      {(['vi', 'en'] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`px-2 py-1 ${lang === l ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          title={l === 'vi' ? 'Tiếng Việt' : 'English'}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </span>
  );
};
