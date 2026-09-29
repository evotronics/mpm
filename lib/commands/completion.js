/**
 * `mpm completion <shell>`: print a shell completion script.
 *
 * The scripts call `mpm __complete -- <words...>`, so completions follow the
 * installed version of mpm and the current workspace.
 */
import {UsageError} from '../errors.js';

const BINS = 'mpm multiple-project-manager';

export const SCRIPTS = {
  bash: `\
# mpm bash completion.
# Load in ~/.bashrc with:  source <(mpm completion bash)
# or save it in the bash-completion user directory:
#   mpm completion bash > ~/.local/share/bash-completion/completions/mpm
_mpm_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local IFS=$'\\n'
  local -a lines
  lines=($(mpm __complete -- "\${COMP_WORDS[@]:1:COMP_CWORD}" 2>/dev/null))
  case "\${lines[0]}" in
    __files__)
      COMPREPLY=($(compgen -f -- "$cur"))
      compopt -o filenames 2>/dev/null
      return 0 ;;
    __dirs__)
      COMPREPLY=($(compgen -d -- "$cur"))
      compopt -o filenames 2>/dev/null
      return 0 ;;
  esac
  COMPREPLY=("\${lines[@]%%$'\\t'*}")
}
complete -o default -o bashdefault -F _mpm_completion ${BINS}
`,

  zsh: `\
#compdef ${BINS}
# mpm zsh completion.
# Load in ~/.zshrc (after compinit) with:  source <(mpm completion zsh)
# or save it in a directory in $fpath:  mpm completion zsh > ~/.zfunc/_mpm
_mpm() {
  local -a lines completions
  local line value desc
  lines=("\${(@f)$(mpm __complete -- "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  case "\${lines[1]}" in
    __files__) _files; return ;;
    __dirs__) _files -/; return ;;
  esac
  for line in "\${lines[@]}"; do
    [[ -z "$line" ]] && continue
    value="\${line%%$'\\t'*}"
    desc=""
    [[ "$line" == *$'\\t'* ]] && desc="\${line#*$'\\t'}"
    completions+=("\${value//:/\\\\:}\${desc:+:$desc}")
  done
  _describe -t mpm mpm completions
}
if [[ "\${funcstack[1]}" == "_mpm" ]]; then
  _mpm "$@"
else
  compdef _mpm ${BINS}
fi
`,

  fish: `\
# mpm fish completion.
# Save it:  mpm completion fish > ~/.config/fish/completions/mpm.fish
function __mpm_complete
    set -l tokens (commandline -opc) (commandline -ct)
    set -e tokens[1]
    set -l out (mpm __complete -- $tokens 2>/dev/null)
    switch "$out[1]"
        case __files__
            __fish_complete_path (commandline -ct)
        case __dirs__
            __fish_complete_directories (commandline -ct)
        case '*'
            printf '%s\\n' $out
    end
end
${BINS.split(' ').map(bin =>
  `complete -c ${bin} -f -a '(__mpm_complete)'`).join('\n')}
`
};

export default {
  name: 'completion',
  helpGroup: 'Workspace and config commands:',
  summary: 'Print a shell completion script (bash, zsh, fish)',
  description: 'Print a completion script for bash, zsh, or fish. ' +
    'Completes commands, options, repo names, group ids, tags, config ' +
    'keys, and aliases from the current workspace.\n\n' +
    'Install:\n' +
    '  bash: add `source <(mpm completion bash)` to ~/.bashrc\n' +
    '  zsh:  add `source <(mpm completion zsh)` to ~/.zshrc (after ' +
    'compinit)\n' +
    '  fish: mpm completion fish > ~/.config/fish/completions/mpm.fish',
  workspace: false,
  arguments: [{name: '<shell>', description: 'bash, zsh, or fish',
    complete: 'shells'}],

  async run({args}) {
    const script = SCRIPTS[args[0]];
    if(!script) {
      throw new UsageError(`Unknown shell "${args[0]}"; use bash, zsh, or ` +
        'fish.');
    }
    return {data: {shell: args[0], script}};
  },

  text: {
    end({data}) {
      return data.script;
    }
  }
};
