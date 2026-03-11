from pathlib import Path

def split_file(filepath, test_file):
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()
    
    idx = code.find('#[cfg(test)]\nmod tests {')
    if idx == -1: return
    
    test_block = code[idx:]
    test_content = test_block.split('{', 1)[1].rsplit('}', 1)[0].strip() + '\n'
    
    with open(test_file, 'w', encoding='utf-8') as f:
        f.write(test_content)
        
    main_code = code[:idx] + '#[cfg(test)]\n#[path = "' + test_file + '"]\nmod tests;\n'
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(main_code)

ROOT = Path(__file__).resolve().parents[3]

split_file(
    ROOT / 'apps/desktop-tauri/src-tauri/src/app_state.rs',
    ROOT / 'apps/desktop-tauri/src-tauri/src/tests/app_state_tests.rs',
)
