import AppKit
import SwiftUI

struct CreateWorktreeSheet: View {
    @Environment(\.dismiss) private var dismiss

    let onSubmit: (CreateWorktreeMode, String?) async -> Void

    @State private var mode: CreateWorktreeMode = .new
    @State private var branch = ""
    @State private var isSubmitting = false
    @FocusState private var branchFieldFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Create Worktree")
                .font(.title2.weight(.semibold))

            Picker("Mode", selection: $mode) {
                ForEach(CreateWorktreeMode.allCases) { mode in
                    Text(mode.rawValue.capitalized)
                        .tag(mode)
                }
            }
            .pickerStyle(.segmented)

            TextField(
                mode == .new ? "Branch name (optional)" : "Existing branch name",
                text: $branch
            )
            .textFieldStyle(.roundedBorder)
            .focused($branchFieldFocused)

            Text(mode == .new ? "Leave blank to let webmux generate a branch name." : "Type the existing branch to open as a managed worktree.")
                .foregroundStyle(.secondary)

            HStack {
                Spacer()

                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Button(isSubmitting ? "Working..." : "Create") {
                    isSubmitting = true
                    Task {
                        await onSubmit(mode, branch)
                        isSubmitting = false
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isSubmitting || (mode == .existing && branch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
            }
        }
        .padding(20)
        .frame(width: 420)
        .onAppear {
            focusBranchField()
        }
        .onChange(of: mode) {
            focusBranchField()
        }
    }

    private func focusBranchField() {
        Task { @MainActor in
            NSApp.activate()
            branchFieldFocused = true
        }
    }
}
