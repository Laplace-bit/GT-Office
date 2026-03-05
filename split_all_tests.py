import os

files_to_split = [
    "crates/vb-workspace/src/lib.rs",
    "crates/vb-terminal/src/lib.rs",
    "crates/vb-settings/src/lib.rs",
    "crates/vb-git/src/lib.rs",
    "crates/vb-daemon/src/util/ring_buffer.rs",
    "crates/vb-daemon/src/protocol/codec.rs",
    "crates/vb-daemon/src/search/service.rs",
    "crates/vb-daemon/src/fileio/service.rs",
    "apps/desktop-tauri/src-tauri/src/channel_adapter_runtime.rs",
    "apps/desktop-tauri/src-tauri/src/filesystem_watcher.rs",
    "apps/desktop-tauri/src-tauri/src/commands/filesystem.rs",
    "apps/desktop-tauri/src-tauri/src/commands/git.rs",
    "apps/desktop-tauri/src-tauri/src/commands/terminal.rs",
    "apps/desktop-tauri/src-tauri/src/commands/workspace.rs"
]

for filepath in files_to_split:
    if not os.path.exists(filepath):
        continue
    
    with open(filepath, 'r', encoding='utf-8') as f:
        code = f.read()

    idx = code.find('#[cfg(test)]\nmod tests {')
    if idx == -1: 
        idx = code.find('#[cfg(test)]\r\nmod tests {')
    if idx == -1:
        continue

    # Find the matching closing bracket
    test_block = code[idx:]
    start_brace = test_block.find('{')
    brace_count = 1
    end_brace = start_brace + 1
    while end_brace < len(test_block) and brace_count > 0:
        if test_block[end_brace] == '{':
            brace_count += 1
        elif test_block[end_brace] == '}':
            brace_count -= 1
        end_brace += 1
        
    test_content = test_block[start_brace+1:end_brace-1].strip() + '\n'
    test_file = filepath.replace('.rs', '_tests.rs')
    test_basename = os.path.basename(test_file)
    
    with open(test_file, 'w', encoding='utf-8') as f:
        f.write(test_content)
        
    main_code = code[:idx] + '#[cfg(test)]\n#[path = "' + test_basename + '"]\nmod tests;\n' + code[idx + end_brace:]
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(main_code)
    
    print(f"Split tests from {filepath} into {test_file}")

