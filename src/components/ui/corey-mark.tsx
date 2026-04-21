import { type ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Brand mark for Corey — cyan→violet "Cy" glyph on a black square with a
 * glowing core. Shipped as a raster (`public/corey.png`) to preserve the
 * gradient integrity that SVG recoloring would have muddied.
 *
 * Rounded corners on every instance so the dark square reads as an icon
 * tile rather than a hard block on light-themed surfaces.
 */
export function CoreyMark({
  className,
  alt = 'Corey',
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  return (
    <img
      src="/corey.png"
      alt={alt}
      draggable={false}
      className={cn('select-none rounded-md object-contain', className)}
      {...rest}
    />
  );
}
