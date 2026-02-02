interface HeaderProps {
  tikiPath: string;
  onResetLayout: () => void;
}

export function Header({ tikiPath, onResetLayout }: HeaderProps) {
  return (
    <>
      <header className="header">
        <h1>Tiki</h1>
        <span className="subtitle">GitHub Issue Workflow</span>
      </header>
      <footer className="footer">
        <span className="path">{tikiPath}</span>
        <button
          className="reset-layout-btn"
          onClick={onResetLayout}
          title="Reset layout to defaults"
        >
          Reset Layout
        </button>
      </footer>
    </>
  );
}
