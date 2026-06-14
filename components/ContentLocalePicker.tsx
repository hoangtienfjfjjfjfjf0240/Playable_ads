'use client';

import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getContentLocaleOption, searchContentLocaleOptions } from '../lib/content-locales';
import type { ContentLocale } from '../lib/types';

type ContentLocalePickerProps = {
  value: ContentLocale;
  onChange: (value: ContentLocale) => void;
};

export function ContentLocalePicker({ value, onChange }: ContentLocalePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selectedOption = useMemo(() => getContentLocaleOption(value), [value]);
  const results = useMemo(() => searchContentLocaleOptions(query, 42), [query]);

  useEffect(() => {
    if (!open) return;
    searchInputRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const handleSelect = (nextValue: ContentLocale) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={`locale-picker ${open ? 'open' : ''}`} ref={rootRef}>
      <button
        aria-expanded={open}
        className="locale-picker-trigger"
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setQuery('');
        }}
      >
        <span className="locale-picker-trigger-copy">
          <strong>{selectedOption.label}</strong>
          <small>{selectedOption.value === 'auto' ? 'Use prompt language' : selectedOption.promptName}</small>
        </span>
        <ChevronDown size={16} />
      </button>

      {open ? (
        <div className="locale-picker-popover">
          <label className="locale-picker-search">
            <Search size={15} />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              placeholder="Search language or country"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setOpen(false);
                  setQuery('');
                  return;
                }

                if (event.key === 'Enter' && results[0]) {
                  event.preventDefault();
                  handleSelect(results[0].value);
                }
              }}
            />
          </label>

          <div className="locale-picker-results" role="listbox">
            {results.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  aria-selected={selected}
                  className={`locale-picker-option ${selected ? 'selected' : ''}`}
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option.value)}
                >
                  <span className="locale-picker-option-copy">
                    <strong>{option.label}</strong>
                    <small>{option.value === 'auto' ? 'Follow prompt language' : option.value.toUpperCase()}</small>
                  </span>
                  {selected ? <Check size={15} /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
