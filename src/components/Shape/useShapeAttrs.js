import Color from 'color';
import { getDarker } from 'utils/color';
import { useColorThemeContext } from 'context/ColorThemeContext/useColorThemeContext';

export const useShapeAttrs = ({
  color,
  isSelected,
  isGroupSelected,
  isAnyShapeSoloed,
  isSoloed,
  isMuted,
  isEditMode,
  isHoveredOver,
}) => {
  const { isDarkMode } = useColorThemeContext();
  const alphaAmount = isSelected || isGroupSelected ? 0.8 : 0.4;
  const fill = Color(color)
    .alpha(alphaAmount)
    .toString();
  let opacity = 1;
  if (isAnyShapeSoloed && !isSoloed) {
    opacity = 0.4;
  }
  if (isMuted) {
    opacity = 0.2;
  }
  return {
    fill,
    opacity,
    // darken for contrast against the light canvas - the raw palette
    // colors otherwise read as washed-out against white/light gray; the
    // same colors already contrast fine against the dark-mode canvas, so
    // leave them alone there
    stroke: isDarkMode ? color : getDarker(color, 0.22),
    strokeWidth: isEditMode ? (isHoveredOver ? 4 : 2) : 2,
  };
};
