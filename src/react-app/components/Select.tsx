import ReactSelect, { type Props, type StylesConfig, type GroupBase } from 'react-select';

const customStyles: StylesConfig<any, false, GroupBase<any>> = {
  control: (base, state) => ({
    ...base,
    minHeight: 34,
    fontSize: '0.85rem',
    backgroundColor: 'var(--input-bg)',
    borderColor: state.isFocused ? 'var(--primary)' : 'var(--border)',
    boxShadow: state.isFocused ? '0 0 0 2px var(--primary-light)' : 'none',
    borderRadius: 6,
    color: 'var(--text)',
    '&:hover': { borderColor: 'var(--primary)' },
    cursor: 'pointer',
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '0.83rem',
    padding: '8px 12px',
    backgroundColor: state.isSelected ? 'var(--primary)' : state.isFocused ? 'var(--surface-subtle)' : 'var(--surface-elevated)',
    color: state.isSelected ? '#fff' : 'var(--text)',
    cursor: 'pointer',
    '&:active': { backgroundColor: 'var(--primary-light)' },
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: 'var(--surface-elevated)',
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    border: '1px solid var(--border)',
    zIndex: 50,
    overflow: 'hidden',
  }),
  menuList: (base) => ({
    ...base,
    backgroundColor: 'var(--surface-elevated)',
    maxHeight: 300,
    padding: 4,
  }),
  singleValue: (base) => ({
    ...base,
    fontSize: '0.85rem',
    color: 'var(--text)',
  }),
  placeholder: (base) => ({
    ...base,
    fontSize: '0.83rem',
    color: 'var(--text-subtle)',
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: (base, state) => ({
    ...base,
    padding: '4px 6px',
    color: state.isFocused ? 'var(--primary)' : 'var(--text-subtle)',
    '&:hover': { color: 'var(--primary)' },
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
  menu: (base) => ({
    ...base,
    backgroundColor: 'var(--surface-elevated)',
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    border: '1px solid var(--border)',
    zIndex: 9999,
    overflow: 'hidden',
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
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

interface SelectProps extends Omit<Props<any, boolean, GroupBase<any>>, 'styles'> {
  size?: 'default' | 'sm';
}

export default function Select({ size = 'default', ...props }: SelectProps) {
  return (
    <ReactSelect
      styles={size === 'sm' ? smallStyles : customStyles}
      noOptionsMessage={() => '결과 없음'}
      menuPortalTarget={document.body}
      menuPosition="fixed"
      menuPlacement="auto"
      {...props}
    />
  );
}

// Helper: convert simple options
export function toOptions(items: readonly string[] | string[], labelFn?: (v: string) => string) {
  return items.map((v) => ({ value: v, label: labelFn ? labelFn(v) : v }));
}
