import {ArrowLeft} from 'lucide-react';
import {useMemo} from 'react';

import {catalog} from '../catalog/catalog';
import {Button} from '../components/ui';

/** CC BY-SA attribution for every bundled drawing and text: title, author, license, source. */
export function CreditsView({onBack}: {onBack: () => void}) {
  const licenses = useMemo(() => {
    const counts = new Map<string, {url: string; count: number}>();
    for (const e of catalog)
      for (const s of e.sources) {
        const current = counts.get(s.license) ?? {url: s.licenseUrl, count: 0};
        current.count++;
        counts.set(s.license, current);
      }
    return [...counts.entries()];
  }, []);
  return (
    <div className='credits-view'>
      <header className='detail-header'>
        <Button variant='ghost' size='icon' aria-label='Back to profile' onClick={onBack}>
          <ArrowLeft size={20} />
        </Button>
        <div>
          <h2>Credits and licenses</h2>
          <p>Exercise drawings, instructions and muscle data</p>
        </div>
      </header>
      <p>
        Exercise content comes from the{' '}
        <a href='https://github.com/everkinetic/data' target='_blank' rel='noreferrer'>
          Everkinetic
        </a>{' '}
        and{' '}
        <a href='https://wger.de' target='_blank' rel='noreferrer'>
          wger
        </a>{' '}
        open datasets. Drawings were cropped, resized and recoloured; instructions were converted to
        plain text. Each adapted item keeps its original license. Gym Log is not affiliated with or
        endorsed by these projects or their authors.
      </p>
      <ul className='license-summary'>
        {licenses.map(([license, {url, count}]) => (
          <li key={license}>
            <a href={url} target='_blank' rel='noreferrer'>
              {license}
            </a>{' '}
            · {count} items
          </li>
        ))}
      </ul>
      <ul className='credit-list'>
        {catalog
          .filter((e) => e.sources.length)
          .map((e) => (
            <li key={e.name}>
              <strong>{e.name}</strong>
              {e.sources.map((s, i) => (
                <span key={i}>
                  {s.kind === 'illustration'
                    ? 'Drawing'
                    : s.kind === 'instructions'
                      ? 'Instructions'
                      : 'Muscles'}
                  : “{s.title}” by {s.author} ·{' '}
                  <a href={s.licenseUrl} target='_blank' rel='noreferrer'>
                    {s.license}
                  </a>{' '}
                  ·{' '}
                  <a href={s.url} target='_blank' rel='noreferrer'>
                    source
                  </a>
                </span>
              ))}
            </li>
          ))}
      </ul>
    </div>
  );
}
