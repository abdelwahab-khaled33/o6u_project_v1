import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { O6ULogo } from './O6ULogo';

describe('O6ULogo', () => {
  it('renders the official logo image by default', () => {
    const html = renderToStaticMarkup(<O6ULogo />);
    expect(html).toContain('/o6u-logo.png');
    expect(html).toContain('October 6 University');
  });

  it('falls back to an inline SVG when the image is missing', () => {
    const html = renderToStaticMarkup(<O6ULogo imageMissing />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('/o6u-logo.png');
    expect(html).toContain('October 6 University');
  });

  it('scales height by size', () => {
    expect(renderToStaticMarkup(<O6ULogo size="sm" />)).toContain('height="32"');
    expect(renderToStaticMarkup(<O6ULogo size="md" />)).toContain('height="44"');
    expect(renderToStaticMarkup(<O6ULogo size="lg" />)).toContain('height="60"');
  });
});
