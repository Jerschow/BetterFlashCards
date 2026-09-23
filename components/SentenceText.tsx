"use client";

import { useMemo } from "react";
import { isChineseLanguage, isJapaneseLanguage } from "../lib/languages";

type SentenceTextProps = {
  text: string;
  language: string;
  highlight?: string;
  onWord: (text: string) => void;
};

type SentencePart = { text: string; index: number; isWord: boolean };
type TextRange = { start: number; end: number };

const languageLocales: Record<string, string> = {
  english: "en", spanish: "es", español: "es", french: "fr", français: "fr",
  german: "de", deutsch: "de", italian: "it", portuguese: "pt", russian: "ru",
  korean: "ko", arabic: "ar", hindi: "hi", turkish: "tr", dutch: "nl", thai: "th",
};

export function sentenceLocale(language: string): string | undefined {
  if (isChineseLanguage(language)) return "zh";
  if (isJapaneseLanguage(language)) return "ja";
  const value = language.trim().toLowerCase();
  if (languageLocales[value]) return languageLocales[value];
  if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(value)) return value;
  return undefined;
}

/** Keep punctuation and spacing intact while making natural word groups selectable. */
export function sentenceParts(text: string, language: string): SentencePart[] {
  if (typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(sentenceLocale(language), { granularity: "word" }).segment(text), part => ({
      text: part.segment, index: part.index, isWord: !!part.isWordLike,
    }));
  }
  const parts: SentencePart[] = [];
  let end = 0;
  for (const match of text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}'’\-]*/gu)) {
    const index = match.index!;
    if (index > end) parts.push({ text: text.slice(end, index), index: end, isWord: false });
    parts.push({ text: match[0], index, isWord: true });
    end = index + match[0].length;
  }
  if (end < text.length) parts.push({ text: text.slice(end), index: end, isWord: false });
  return parts;
}

export function sentenceHighlights(text: string, highlight?: string): TextRange[] {
  const term = highlight?.trim();
  if (!term) return [];
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A short Latin word must not highlight the middle of a different word.
  const bounded = /^[\p{Script=Latin}\p{N}]/u.test(term) && /[\p{Script=Latin}\p{N}]$/u.test(term);
  const expression = new RegExp(bounded ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped, "giu");
  return Array.from(text.matchAll(expression), match => ({ start: match.index!, end: match.index! + match[0].length }));
}

function highlightedPart(part: SentencePart, ranges: TextRange[]) {
  const overlapping = ranges.filter(range => range.start < part.index + part.text.length && range.end > part.index);
  if (!overlapping.length) return part.text;
  const result = [];
  let position = 0;
  for (const range of overlapping) {
    const start = Math.max(0, range.start - part.index);
    const end = Math.min(part.text.length, range.end - part.index);
    if (start > position) result.push(<span key={`plain-${position}`}>{part.text.slice(position, start)}</span>);
    result.push(<mark key={`mark-${start}`} className="sentence-highlight">{part.text.slice(start, end)}</mark>);
    position = end;
  }
  if (position < part.text.length) result.push(<span key={`plain-${position}`}>{part.text.slice(position)}</span>);
  return result;
}

/** Render only text the learner can already see; hidden shell words stay outside this component. */
export default function SentenceText({ text, language, highlight, onWord }: SentenceTextProps) {
  const parts = useMemo(() => sentenceParts(text, language), [text, language]);
  const ranges = useMemo(() => sentenceHighlights(text, highlight), [text, highlight]);
  return <span className="sentence-text" lang={sentenceLocale(language)} dir="auto">
    {parts.map(part => part.isWord
      ? <button className="sentence-word" type="button" key={part.index} onClick={() => onWord(part.text)}
          aria-label={`Add ${part.text} to a deck`} title={`Add “${part.text}” to a deck`}>{highlightedPart(part, ranges)}</button>
      : <span key={part.index}>{highlightedPart(part, ranges)}</span>)}
  </span>;
}
