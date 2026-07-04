import { firstString } from "./coerce";

export function cursorPath(params: Record<string, any>): string | undefined {
  return firstString(params.path, params.file_path, params.filePath, params.target_file, params.targetFile, params.value);
}

export function cursorContent(params: Record<string, any>): string | undefined {
  return firstString(params.content, params.contents, params.text, params.value);
}

export function cursorOldText(params: Record<string, any>): string | undefined {
  return firstString(params.oldText, params.old_text, params.old_string, params.oldString, params.old, params.target);
}

export function cursorNewText(params: Record<string, any>): string | undefined {
  return firstString(params.newText, params.new_text, params.new_string, params.newString, params.new, params.replacement);
}

export function cursorSearchPattern(params: Record<string, any>): string | undefined {
  return firstString(params.pattern, params.query, params.regex, params.substring, params.value);
}

export function cursorGlob(params: Record<string, any>): string | undefined {
  return firstString(
    params.glob,
    params.include,
    params.glob_pattern,
    params.globPattern,
    params.glob_filter,
    params.globFilter,
    params.filter,
  );
}