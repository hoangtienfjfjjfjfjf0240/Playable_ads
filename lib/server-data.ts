export function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) throw new Error('Invalid data URL.');
  const mime = match[1].toLowerCase();
  const extension = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1].replace(/[^a-z0-9]/g, '') || 'bin';
  return {
    mime,
    extension,
    buffer: Buffer.from(match[2], 'base64'),
  };
}

export function asDataUrl(value: string, format = 'png') {
  if (value.startsWith('data:image/')) return value;
  const cleanFormat = format.replace(/^image\//, '').replace(/[^a-z0-9.+-]/gi, '') || 'png';
  const mime = format.startsWith('image/') ? format : `image/${cleanFormat}`;
  return `data:${mime};base64,${value}`;
}
