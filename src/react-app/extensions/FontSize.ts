import { Extension } from '@tiptap/core';

export interface FontSizeOptions {
  types: string[];
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create<FontSizeOptions>({
  name: 'fontSize',

  addOptions() {
    return {
      types: ['textStyle'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize?.replace(/['"]+/g, '') || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) => {
          return chain().setMark('textStyle', { fontSize: size }).run();
        },
      unsetFontSize:
        () =>
        ({ chain }) => {
          return chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
        },
    };
  },
});

// 세밀한 폰트 크기 단계 (8pt ~ 72pt)
export const FONT_SIZES = [
  '8px', '9px', '10px', '10.5px', '11px', '12px', '13px', '14px',
  '15px', '16px', '17px', '18px', '20px', '22px', '24px', '26px',
  '28px', '30px', '32px', '36px', '40px', '44px', '48px', '54px',
  '60px', '72px',
];

export const FONT_SIZE_LABELS: Record<string, string> = {
  '8px': '8',
  '9px': '9',
  '10px': '10',
  '10.5px': '10.5',
  '11px': '11',
  '12px': '12',
  '13px': '13',
  '14px': '14',
  '15px': '15',
  '16px': '16',
  '17px': '17',
  '18px': '18',
  '20px': '20',
  '22px': '22',
  '24px': '24',
  '26px': '26',
  '28px': '28',
  '30px': '30',
  '32px': '32',
  '36px': '36',
  '40px': '40',
  '44px': '44',
  '48px': '48',
  '54px': '54',
  '60px': '60',
  '72px': '72',
};
