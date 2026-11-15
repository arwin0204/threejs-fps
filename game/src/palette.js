// MERIDIAN YARD — palette. One dusk-freight palette: cold slate ground, warm amber
// containers, teal Vanguard accents, ember-red opposition. Every colour in the game
// and the page comes from these six values.
export const PALETTE = {
  canvas: '#191d24',
  surface: '#232833',
  hairline: '#39404d',
  ink: '#e8e4d8',
  muted: '#9aa3ad',
  accent: '#f0a830',
  teal: '#35c4a8',
  ember: '#e4572e',
  sky: '#2b3442',
};

export function shade(name) {
  return PALETTE[name];
}
