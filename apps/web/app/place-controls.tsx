'use client';

import type { HealthLevel, Place } from '@lunch/contracts';
import { HealthSelect } from './health-label';

export function PlaceNameControl({
  place,
  editing,
  name,
  busy,
  onChange,
  onSave,
}: {
  place: Place;
  editing: boolean;
  name: string;
  busy: boolean;
  onChange: (name: string) => void;
  onSave: () => Promise<void>;
}) {
  return editing ? (
    <form
      className="inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
    >
      <input
        aria-label={`Rename ${place.name}`}
        value={name}
        onChange={(event) => onChange(event.target.value)}
        maxLength={100}
      />
      <button className="button button-light" disabled={busy || !name.trim()}>
        Save
      </button>
    </form>
  ) : (
    <span>
      {place.name} {!place.active && <small>archived</small>}
    </span>
  );
}

export function PlaceActionControls({
  place,
  busy,
  onRename,
  onUpdate,
}: {
  place: Place;
  busy: boolean;
  onRename: () => void;
  onUpdate: (
    body: { healthLevel?: HealthLevel; active?: boolean },
    notice: string,
  ) => Promise<void>;
}) {
  return (
    <div className="table-actions">
      <HealthSelect
        label={`Health level for ${place.name}`}
        value={place.healthLevel}
        disabled={busy}
        onChange={(healthLevel) => {
          void onUpdate({ healthLevel }, 'Health level updated.');
        }}
      />
      <button disabled={busy} onClick={onRename}>
        Rename
      </button>
      <button
        disabled={busy}
        onClick={() =>
          void onUpdate(
            { active: !place.active },
            place.active ? 'Place archived.' : 'Place restored.',
          )
        }
      >
        {place.active ? 'Archive' : 'Restore'}
      </button>
    </div>
  );
}
