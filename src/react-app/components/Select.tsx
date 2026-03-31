import ReactSelect, { type Props, type StylesConfig, type GroupBase } from 'react-select';

const customStyles: StylesConfig<any, false, GroupBase<any>> = {
  control: (base, state) => ({
    ...base,
    minHeight: 34,
    fontSize: '0.85rem',
    borderColor: state.isFocused ? '#1a73e8' : '#dadce0',
    boxShadow: state.isFocused ? '0 0 0 2px #e8f0fe' : 'none',
    borderRadius: 6,
    '&:hover': { borderColor: '#1a73e8' },
    cursor: 'pointer',
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.83rem',
    padding: '8px 12px',
    backgroundColor: state.isSelected ? '#1a73e8' : state.isFocused ? '#f1f3f4' : '#fff',
    color: state.isSelected ? '#fff' : '#202124',
    cursor: 'pointer',
    '&:active': { backgroundColor: '#e8f0fe' },
  }),
  menu: (base) => ({
    ...base,
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    border: '1px solid #e8eaed',
    zIndex: 50,
    overflow: 'hidden',
  }),
  menuList: (base) => ({
    ...base,
    maxHeight: 300,
    padding: 4,
  }),
  singleValue: (base) => ({
    ...base,
    fontSize: '0.85rem',
    color: '#202124',
  }),
  placeholder: (base) => ({
    ...base,
    fontSize: '0.83rem',
    color: '#9aa0a6',
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: (base, state) => ({
    ...base,
    padding: '4px 6px',
    color: state.isFocused ? '#1a73e8' : '#9aa0a6',
    '&:hover': { color: '#1a73e8' },
    transition: 'transform 0.2s',
    transform: state.selectProps.menuIsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '2px 10px',
  }),
};

const smallStyles: StylesConfig<any, false, GroupBase<any>> = {
  ...customStyles,
  control: (base, state) => ({
    ...(customStyles.control ? (customStyles.control as any)(base, state) : base),
    minHeight: 28,
    fontSize: '0.75rem',
  }),
  option: (base, state) => ({
    ...(customStyles.option ? (customStyles.option as any)(base, state) : base),
    fontSize: '0.75rem',
    padding: '6px 10px',
  }),
  singleValue: (base) => ({
    ...base,
    fontSize: '0.75rem',
  }),
  placeholder: (base) => ({
    ...base,
    fontSize: '0.75rem',
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0 8px',
  }),
};

interface SelectProps extends Omit<Props<any, false, GroupBase<any>>, 'styles'> {
  size?: 'default' | 'sm';
}

export default function Select({ size = 'default', ...props }: SelectProps) {
  return (
    <ReactSelect
      styles={size === 'sm' ? smallStyles : customStyles}
      noOptionsMessage={() => '결과 없음'}
      menuPortalTarget={document.body}
      menuPosition="fixed"
      {...props}
    />
  );
}

// Helper: convert simple options
export function toOptions(items: readonly string[] | string[], labelFn?: (v: string) => string) {
  return items.map((v) => ({ value: v, label: labelFn ? labelFn(v) : v }));
}
