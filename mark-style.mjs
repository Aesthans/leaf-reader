export const markColors = {
  yellow: ['琥珀', '#db901b'], pink: ['玫红', '#dd5878'],
  purple: ['紫色', '#9464d8'], blue: ['蓝色', '#338dd7'], green: ['绿色', '#3ba368']
};

export const markStyles = { highlight: '高亮', underline: '直线', wavy: '波浪线' };

export function appearance(mark) {
  if (!Object.hasOwn(markStyles, mark.style)) return;
  const color = Object.hasOwn(markColors, mark.color) ? mark.color : 'yellow';
  return { style: mark.style, color, ink: markColors[color][1] };
}

export function markDecoration(style, ink) {
  return style === 'highlight' ? `background-color: ${ink}55;` :
    `text-decoration: underline ${style === 'wavy' ? 'wavy' : 'solid'} ${ink};`;
}
