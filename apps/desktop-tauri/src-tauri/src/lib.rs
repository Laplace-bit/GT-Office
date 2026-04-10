mod app_state;
mod channel_adapter_runtime;
mod channel_sinks;
mod commands;
mod connectors;
mod daemon_bridge;
mod external_tool_profiles;
mod filesystem_watcher;
mod local_bridge;
mod process_utils;
mod terminal_debug;

use base64::Engine;
use gt_terminal::TerminalRuntimeEvent;
use rustls::crypto::aws_lc_rs;
use serde_json::json;
#[cfg(target_os = "linux")]
use tauri::TitleBarStyle;
use tauri::{Emitter, Manager, WebviewWindowBuilder};
use tracing::warn;

use commands::{
    agent, agentic_one, file_explorer, git, keybindings, security, settings, system, task_center,
    terminal, tool_adapter, workspace,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = aws_lc_rs::default_provider().install_default();

    tauri::Builder::default()
        .manage(app_state::AppState::default())
        .setup(|app| {
            let _ = terminal_debug::dev_log::reset_dev_logs(&app.handle());
            let main_window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .cloned()
                .ok_or_else(|| "missing main window config".to_string())?;
            let main_window_builder = WebviewWindowBuilder::from_config(app, &main_window_config)
                .map_err(|error| format!("failed to prepare main window builder: {error}"))?;
            #[cfg(target_os = "linux")]
            let main_window_builder = main_window_builder
                .decorations(true)
                .transparent(false)
                .shadow(false)
                .title_bar_style(TitleBarStyle::Visible)
                .hidden_title(false);
            main_window_builder
                .build()
                .map_err(|error| format!("failed to build main window: {error}"))?;

            let app_handle = app.handle().clone();
            let state = app.state::<app_state::AppState>();
            if let Err(error) =
                tool_adapter::restore_persisted_channel_state(&app_handle, state.inner())
            {
                warn!(error = %error, "restore persisted channel state failed");
            }
            local_bridge::spawn(app_handle.clone(), state.inner().clone());
            channel_adapter_runtime::spawn(app_handle.clone(), state.inner().clone());
            connectors::feishu::websocket::spawn_supervisor(app_handle.clone(), state.inner().clone());
            connectors::telegram::spawn_polling_worker(app_handle.clone(), state.inner().clone());
            connectors::wechat::spawn_polling_supervisor(app_handle.clone(), state.inner().clone());
            tool_adapter::spawn_external_reply_flush_worker(
                app_handle.clone(),
                state.inner().clone(),
            );
            let receiver = state.terminal_provider.take_event_receiver().map_err(|error| {
                format!(
                    "failed to subscribe terminal runtime events during setup: {}",
                    error
                )
            })?;
            let relay_state = state.inner().clone();

            std::thread::spawn(move || {
                while let Ok(event) = receiver.recv() {
                    match event {
                        TerminalRuntimeEvent::Output(output) => {
                            tool_adapter::ingest_external_reply_terminal_output(
                                &relay_state,
                                &output.session_id,
                                &output.chunk,
                                output.ts_ms,
                            );
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
                        TerminalRuntimeEvent::StateChanged(terminal_state) => {
                            tool_adapter::ingest_external_reply_terminal_state(
                                &relay_state,
                                &terminal_state.session_id,
                                terminal_state.to.as_str(),
                                terminal_state.ts_ms,
                            );
                            let _ = app_handle.emit(
                                "terminal/state_changed",
                                json!({
                                    "sessionId": terminal_state.session_id,
                                    "from": terminal_state.from,
                                    "to": terminal_state.to,
                                    "tsMs": terminal_state.ts_ms,
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
            workspace::workspace_reset_state,
            workspace::surface::surface_open_detached_window,
            workspace::surface::surface_close_window,
            workspace::surface::surface_set_window_topmost,
            workspace::surface::surface_start_window_dragging,
            workspace::surface::surface_bridge_post,
            agent::agent_department_list,
            agent::agent_role_list,
            agent::agent_role_save,
            agent::agent_role_delete,
            agent::agent_role_restore_system,
            agent::agent_list,
            agent::agent_create,
            agent::agent_update,
            agent::agent_delete,
            agent::agent_prompt_read,
            agent::agent_reorder,
            agentic_one::agent_install_status,
            agentic_one::install_agent,
            agentic_one::uninstall_agent,
            file_explorer::fs_list_dir,
            file_explorer::fs_read_file,
            file_explorer::fs_read_file_full,
            file_explorer::fs_write_file,
            file_explorer::fs_create_dir,
            file_explorer::fs_delete,
            file_explorer::fs_move,
            file_explorer::fs_copy,
            file_explorer::fs_show_in_folder,
            file_explorer::fs_search_stream_start,
            file_explorer::fs_search_stream_cancel,
            file_explorer::fs_search_text,
            file_explorer::fs_search_files,
            file_explorer::preview::fs_get_file_info,
            file_explorer::preview::fs_image_thumbnail,
            file_explorer::preview::fs_pdf_get_info,
            file_explorer::preview::fs_pdf_render_page,
            terminal::terminal_create,
            terminal::terminal_write,
            terminal::terminal_write_with_submit,
            terminal::terminal_resize,
            terminal::terminal_kill,
            terminal::terminal_set_visibility,
            terminal::terminal_read_snapshot,
            terminal::terminal_read_delta,
            terminal::terminal_describe_processes,
            terminal::terminal_report_rendered_screen,
            terminal::terminal_debug_clear_human_log,
            terminal::terminal_debug_append_frontend_focus_log,
            terminal::terminal_activate,
            terminal::terminal_get_rendered_screen,
            terminal::terminal_open_output_channel,
            git::git_status,
            git::git_init,
            git::git_diff_file,
            git::git_diff_file_structured,
            git::git_diff_file_expansion,
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
            tool_adapter::command_catalog::tool_list_commands,
            tool_adapter::tool_profiles::tool_list_profiles,
            tool_adapter::tool_profiles::tool_launch,
            tool_adapter::tool_profiles::tool_validate_profile,
            task_center::task_list,
            task_center::task_dispatch_batch,
            task_center::task_list_threads,
            task_center::task_get_thread,
            task_center::channel_publish,
            task_center::channel_list_messages,
            tool_adapter::channel_adapter_status,
            tool_adapter::channel_connector_account_upsert,
            tool_adapter::channel_connector_account_list,
            tool_adapter::channel_connector_health,
            tool_adapter::channel_connector_webhook_sync,
            tool_adapter::channel_connector_wechat_auth_start,
            tool_adapter::channel_connector_wechat_auth_status,
            tool_adapter::channel_connector_wechat_auth_cancel,
            tool_adapter::channel_binding_upsert,
            tool_adapter::channel_binding_list,
            tool_adapter::channel_binding_delete,
            tool_adapter::channel_access_policy_set,
            tool_adapter::channel_access_approve,
            tool_adapter::channel_access_list,
            tool_adapter::channel_external_inbound,
            task_center::agent_runtime_register,
            task_center::agent_runtime_unregister,
            task_center::changefeed_query,
            settings::settings_get_effective,
            settings::settings_update,
            settings::settings_reset,
            keybindings::keymap_list,
            keybindings::keymap_update_binding,
            keybindings::keymap_reset,
            system::system_gto_cli_status,
            system::system_gto_cli_install,
            system::system_gto_cli_uninstall,
            system::system_gto_skill_status,
            system::system_gto_skill_install,
            system::system_gto_skill_uninstall,
            settings::ai_config::ai_config_read_snapshot,
            settings::ai_config::ai_config_preview_patch,
            settings::ai_config::ai_config_apply_patch,
            settings::ai_config::ai_config_list_audit_logs,
            settings::ai_config::ai_config_switch_saved_provider,
            settings::ai_config::ai_config_delete_saved_provider,
            security::security_health,
            system::system_gto_doctor,
            system::system_pick_directory,
            system::system_open_url,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri app");
}
