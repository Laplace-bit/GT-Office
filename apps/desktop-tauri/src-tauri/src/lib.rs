mod app_state;
mod channel_adapter_runtime;
mod commands;
mod connectors;
mod daemon_bridge;
mod filesystem_watcher;
mod mcp_bridge;

use base64::Engine;
use serde_json::json;
use tauri::{Emitter, Manager};
use vb_terminal::TerminalRuntimeEvent;

use commands::{
    agent, ai_config, channel_adapter, filesystem, git, keymap, security, settings, system, tasks,
    terminal, tools, workspace,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(app_state::AppState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let state = app.state::<app_state::AppState>();
            mcp_bridge::spawn(app_handle.clone(), state.inner().clone());
            channel_adapter_runtime::spawn(app_handle.clone(), state.inner().clone());
            connectors::telegram::spawn_polling_worker(app_handle.clone(), state.inner().clone());
            let receiver = state.terminal_provider.take_event_receiver().map_err(|error| {
                format!(
                    "failed to subscribe terminal runtime events during setup: {}",
                    error
                )
            })?;

            std::thread::spawn(move || {
                while let Ok(event) = receiver.recv() {
                    match event {
                        TerminalRuntimeEvent::Output(output) => {
                            let _ = app_handle.emit(
                                "terminal/output",
                                json!({
                                    "sessionId": output.session_id,
                                    "chunk": base64::engine::general_purpose::STANDARD.encode(output.chunk),
                                    "seq": output.seq,
                                    "tsMs": output.ts_ms,
                                }),
                            );
                        }
                        TerminalRuntimeEvent::StateChanged(state) => {
                            let _ = app_handle.emit(
                                "terminal/state_changed",
                                json!({
                                    "sessionId": state.session_id,
                                    "from": state.from,
                                    "to": state.to,
                                    "tsMs": state.ts_ms,
                                }),
                            );
                        }
                        TerminalRuntimeEvent::Meta(meta) => {
                            let _ = app_handle.emit(
                                "terminal/meta",
                                json!({
                                    "sessionId": meta.session_id,
                                    "unreadBytes": meta.unread_bytes,
                                    "unreadChunks": meta.unread_chunks,
                                    "tailChunk": base64::engine::general_purpose::STANDARD.encode(meta.tail_chunk),
                                    "tsMs": meta.ts_ms,
                                }),
                            );
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace::workspace_list,
            workspace::workspace_open,
            workspace::workspace_close,
            workspace::workspace_restore_session,
            workspace::workspace_switch_active,
            workspace::workspace_get_context,
            workspace::workspace_get_window_active,
            agent::agent_department_list,
            agent::agent_role_list,
            agent::agent_list,
            agent::agent_create,
            filesystem::fs_list_dir,
            filesystem::fs_read_file,
            filesystem::fs_read_file_full,
            filesystem::fs_write_file,
            filesystem::fs_delete,
            filesystem::fs_move,
            filesystem::fs_search_stream_start,
            filesystem::fs_search_stream_cancel,
            filesystem::fs_search_text,
            filesystem::fs_search_files,
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            terminal::terminal_set_visibility,
            terminal::terminal_read_snapshot,
            git::git_status,
            git::git_init,
            git::git_diff_file,
            git::git_diff_file_structured,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            git::git_commit,
            git::git_log,
            git::git_commit_detail,
            git::git_list_branches,
            git::git_checkout,
            git::git_create_branch,
            git::git_delete_branch,
            git::git_fetch,
            git::git_pull,
            git::git_push,
            git::git_stash_push,
            git::git_stash_pop,
            git::git_stash_list,
            tools::tool_list_profiles,
            tools::tool_launch,
            tools::tool_validate_profile,
            tasks::task_list,
            tasks::task_dispatch_batch,
            tasks::channel_publish,
            channel_adapter::channel_adapter_status,
            channel_adapter::channel_connector_account_upsert,
            channel_adapter::channel_connector_account_list,
            channel_adapter::channel_connector_health,
            channel_adapter::channel_connector_webhook_sync,
            channel_adapter::channel_binding_upsert,
            channel_adapter::channel_binding_list,
            channel_adapter::channel_access_policy_set,
            channel_adapter::channel_access_approve,
            channel_adapter::channel_access_list,
            channel_adapter::channel_external_inbound,
            tasks::agent_runtime_register,
            tasks::agent_runtime_unregister,
            tasks::changefeed_query,
            settings::settings_get_effective,
            settings::settings_update,
            settings::settings_reset,
            keymap::keymap_list,
            keymap::keymap_update_binding,
            keymap::keymap_reset,
            ai_config::ai_config_read_snapshot,
            ai_config::ai_config_preview_patch,
            ai_config::ai_config_apply_patch,
            security::security_health,
            system::system_gto_doctor,
            system::system_pick_directory,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
