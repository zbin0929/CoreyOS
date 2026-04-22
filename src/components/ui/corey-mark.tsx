import { type ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Brand mark for Corey — cyan→violet "Cy" glyph on a black square with a
 * glowing core. Shipped as a raster (`public/corey.png`) to preserve the
 * gradient integrity that SVG recoloring would have muddied.
 *
 * Rounded corners on every instance so the dark square reads as an icon
 * tile rather than a hard block on light-themed surfaces.
 *
 * NOTE: `alt=""` is deliberate — the brand is ALWAYS rendered next to
 * a visible text label (the `{t('app.name')}` span in the Sidebar),
 * so a non-empty alt would (a) make screen readers announce "Corey"
 * twice and (b) render as ghostly fallback text INSIDE the image box
 * while the PNG is decoding on first paint. `role="presentation"`
 * makes the image-is-decorative intent explicit.
 */
export function CoreyMark({
  className,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt'>) {
  return (
    <img
      src="/corey.png"
      alt=""
      role="presentation"
      draggable={false}
      className={cn('select-none rounded-md object-contain', className)}
      {...rest}
    />
  );
}
