"use client";

/** Only call this for text the learner is already allowed to see. */
export default function CharacterText({ text, onCharacter }: { text: string; onCharacter?: (character: string) => void }) {
  if (!onCharacter) return <>{text}</>;
  return <span className="character-text" dir="auto">
    {Array.from(text).map((character, index) => /\p{Script=Han}/u.test(character)
      ? <button key={index} className="character-link" type="button" onClick={() => onCharacter(character)} aria-label={`Open a memory story for ${character}`} title={`Memory story for ${character}`}>{character}</button>
      : <span key={index}>{character}</span>)}
    <style jsx>{`
      .character-text { display: inline; }
      .character-link { display: inline; padding: .04em .08em; margin: 0 .015em; color: inherit; font: inherit; line-height: inherit; border: 0; border-bottom: 1px dotted currentColor; border-radius: 3px; background: transparent; cursor: pointer; vertical-align: baseline; }
      .character-link:hover { background: #dcebe2; }
      .character-link:focus-visible { outline: 3px solid #257765; outline-offset: 2px; }
    `}</style>
  </span>;
}
