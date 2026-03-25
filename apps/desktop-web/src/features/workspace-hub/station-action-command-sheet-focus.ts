export type CommandSheetInitialFocusTarget = 'field' | 'submit' | 'close'

export interface CommandSheetInitialFocusOptions {
  hasEditableField: boolean
  isSubmitDisabled: boolean
}

export function resolveCommandSheetInitialFocusTarget(
  options: CommandSheetInitialFocusOptions,
): CommandSheetInitialFocusTarget {
  if (options.hasEditableField) {
    return 'field'
  }

  if (!options.isSubmitDisabled) {
    return 'submit'
  }

  return 'close'
}
