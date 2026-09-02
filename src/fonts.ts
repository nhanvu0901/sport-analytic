import { loadFont as loadRoboto, getInfo as robotoInfo } from '@remotion/google-fonts/Roboto';
import { loadFont as loadCondensed, getInfo as condensedInfo } from '@remotion/google-fonts/RobotoCondensed';
import { loadFont as loadCaveat, getInfo as caveatInfo } from '@remotion/google-fonts/Caveat';

// Loading at module scope makes Remotion wait for the faces before it paints a
// frame. Getting this wrong is the classic "first frames render in Times" bug.
loadRoboto('normal', { weights: ['400', '500', '700'], subsets: ['latin'] });
loadCondensed('normal', { weights: ['400', '700'], subsets: ['latin'] });
loadCaveat('normal', { weights: ['700'], subsets: ['latin'] });

const stack = (f: string) => `"${f}", "Helvetica Neue", Arial, sans-serif`;
export const FF = {
  body: stack(robotoInfo().fontFamily),
  cond: stack(condensedInfo().fontFamily),
  hand: `"${caveatInfo().fontFamily}", "Bradley Hand", cursive`,
};
