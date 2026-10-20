import { Readiness } from './readiness';

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8 sm:px-12">
      <header className="flex items-center justify-between border-b border-green-950/15 pb-6">
        <span className="text-lg font-black tracking-tight">
          ✳ LUNCH ROLLER
        </span>
        <span className="rounded-full border border-green-950/20 px-3 py-1 text-xs font-bold uppercase tracking-widest">
          Foundation v0.1
        </span>
      </header>
      <section className="grid items-center gap-12 py-16 md:grid-cols-[1.2fr_1fr] md:py-24">
        <div>
          <p className="mb-5 text-xs font-bold uppercase tracking-[0.25em]">
            One team. One wheel. Lunch sorted.
          </p>
          <h1 className="max-w-xl text-6xl leading-[0.98] font-black tracking-[-0.065em] sm:text-8xl">
            All hail
            <br />
            the lunch wheel.
          </h1>
          <p className="mt-7 max-w-md text-lg leading-relaxed text-green-950/70">
            A little chance. A little friendly persuasion. Your next lunch spot
            is a spin away.
          </p>
          <Readiness />
        </div>
        <div
          className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center"
          aria-hidden="true"
        >
          <div className="absolute -top-3 z-10 text-5xl text-green-950">▼</div>
          <div
            className="flex h-full w-full items-center justify-center rounded-full border-[10px] border-[#253a2d] shadow-[12px_12px_0_#253a2d]"
            style={{
              background:
                'conic-gradient(#f7c856 0deg 120deg, #b8cf9c 120deg 240deg, #e8a188 240deg 360deg)',
            }}
          >
            <div className="flex h-28 w-28 items-center justify-center rounded-full border-8 border-[#253a2d] bg-[#f8f6ef] text-2xl font-black">
              LUNCH
            </div>
          </div>
        </div>
      </section>
      <section
        className="grid gap-px overflow-hidden rounded-2xl border border-green-950/15 bg-green-950/15 sm:grid-cols-3"
        aria-label="Game rules"
      >
        {[
          [
            '01 / THE EDICT',
            '11:30. The wheel speaks.',
            'Every weekday, one shared choice. Europe/Dublin time.',
          ],
          [
            '02 / THE TWIST',
            'Winners lose half their weight.',
            'Every win makes room for somewhere different next time.',
          ],
          [
            '03 / THE INFLUENCE',
            'Show up. Earn your say.',
            'Earn 10 tokens for lunch. Spend them to sway the odds.',
          ],
        ].map(([label, title, text]) => (
          <article key={label} className="bg-[#f8f6ef] p-7">
            <p className="mb-5 text-xs font-bold tracking-widest">{label}</p>
            <h2 className="mb-3 text-xl font-bold tracking-tight">{title}</h2>
            <p className="text-sm leading-relaxed text-green-950/70">{text}</p>
          </article>
        ))}
      </section>
      <footer className="mt-8 flex flex-wrap justify-between gap-4 text-xs text-green-950/65">
        <p>
          Scaffold ready. Playable wheel, name selection, and token actions are
          coming next.
        </p>
        <a className="underline underline-offset-4" href="/api/v1/health">
          Service health ↗
        </a>
      </footer>
    </main>
  );
}
