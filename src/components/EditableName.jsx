import { useState } from 'react';

// 이름 옆 ✏️ 를 누르면 그 자리에서 고칠 수 있는 이름
export default function EditableName({ value, onSave, max = 16 }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(value);
  if (!edit)
    return (
      <span>
        {value}{' '}
        <button
          className="sm ghost"
          title="이름 바꾸기"
          onClick={(e) => {
            e.stopPropagation();
            setText(value);
            setEdit(true);
          }}
        >
          ✏️
        </button>
      </span>
    );
  const save = () => {
    const t = text.trim().slice(0, max);
    if (t && t !== value) onSave(t);
    setEdit(false);
  };
  return (
    <span className="row" style={{ gap: 4, display: 'inline-flex' }} onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={text}
        maxLength={max}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEdit(false);
        }}
        style={{ width: 130, padding: '2px 6px' }}
      />
      <button className="sm" onClick={save}>
        확인
      </button>
    </span>
  );
}
