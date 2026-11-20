'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { removePhoto, saveHomeClub, savePhoto } from '@/actions/profile';
import { MAX_PHOTO_BYTES, PHOTO_SIZE } from '@/lib/photo';

/** Center-crop to a square and shrink to PHOTO_SIZE in the browser; returns base64 JPEG (no prefix). */
async function toSmallJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('unreadable'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = PHOTO_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
    for (const q of [0.85, 0.7, 0.55]) {
      const b64 = canvas.toDataURL('image/jpeg', q).split(',')[1] ?? '';
      if ((b64.length * 3) / 4 <= MAX_PHOTO_BYTES) return b64;
    }
    throw new Error('too big');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function ProfileForm({ homeClub, hasPhoto }: { homeClub: string | null; hasPhoto: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [club, setClub] = useState(homeClub ?? '');
  const [busy, setBusy] = useState<null | 'photo' | 'club'>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('photo');
    setMessage(null);
    try {
      const r = await savePhoto(await toSmallJpeg(file));
      if (!r.ok) return setMessage({ kind: 'error', text: r.error });
      setMessage({ kind: 'ok', text: 'Photo saved.' });
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: 'That picture could not be used. Try another one.' });
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    setBusy('photo');
    setMessage(null);
    try {
      const r = await removePhoto();
      if (!r.ok) return setMessage({ kind: 'error', text: r.error });
      setMessage({ kind: 'ok', text: 'Photo removed.' });
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: 'Could not remove it. Check your connection and try again.' });
    } finally {
      setBusy(null);
    }
  }

  async function onClub(e: React.FormEvent) {
    e.preventDefault();
    setBusy('club');
    setMessage(null);
    try {
      const r = await saveHomeClub(club);
      if (!r.ok) return setMessage({ kind: 'error', text: r.error });
      setMessage({ kind: 'ok', text: 'Home club saved.' });
      router.refresh();
    } catch {
      setMessage({ kind: 'error', text: 'Could not save. Check your connection and try again.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={onPhoto} aria-label="Choose a photo" />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} className="btn-gold flex-1 disabled:opacity-60">
          {busy === 'photo' ? 'Saving…' : hasPhoto ? 'Change photo' : 'Add photo'}
        </button>
        {hasPhoto && (
          <button type="button" onClick={onRemove} disabled={busy !== null} className="min-h-[48px] rounded-lg border-2 border-white/25 px-4 font-label font-semibold uppercase tracking-wider text-silver-300 disabled:opacity-60">
            Remove
          </button>
        )}
      </div>

      <form onSubmit={onClub} className="space-y-2">
        <label htmlFor="home-club" className="eyebrow block text-silver-300">Home club</label>
        <div className="flex gap-2">
          <input
            id="home-club"
            value={club}
            maxLength={60}
            onChange={(e) => setClub(e.target.value)}
            placeholder="e.g. Cherokee Ridge"
            className="min-h-[52px] min-w-0 flex-1 rounded-lg border-2 border-white/20 bg-navy-800/80 px-3 text-lg text-white placeholder:text-silver-400 focus:border-gold-400 focus:outline-none"
          />
          <button type="submit" disabled={busy !== null} className="btn-red shrink-0 disabled:opacity-60">
            {busy === 'club' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'font-semibold text-brandred-500' : 'font-semibold text-gold-400'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
