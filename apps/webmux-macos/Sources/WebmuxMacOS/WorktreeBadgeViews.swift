import SwiftUI

struct WorktreeBadgeStyle {
    let foreground: Color
    let background: Color
    let border: Color

    static let neutral = WorktreeBadgeStyle(
        foreground: .secondary,
        background: Color.secondary.opacity(0.08),
        border: Color.secondary.opacity(0.18)
    )
    static let accent = WorktreeBadgeStyle(
        foreground: .accentColor,
        background: Color.accentColor.opacity(0.12),
        border: Color.accentColor.opacity(0.25)
    )
    static let success = WorktreeBadgeStyle(
        foreground: .green,
        background: Color.green.opacity(0.12),
        border: Color.green.opacity(0.22)
    )
    static let warning = WorktreeBadgeStyle(
        foreground: .orange,
        background: Color.orange.opacity(0.12),
        border: Color.orange.opacity(0.22)
    )
    static let danger = WorktreeBadgeStyle(
        foreground: .red,
        background: Color.red.opacity(0.12),
        border: Color.red.opacity(0.22)
    )
}

struct WorktreeBadge: View {
    let text: String
    let style: WorktreeBadgeStyle
    var systemImage: String? = nil
    var monospaced = false

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 8, weight: .semibold))
            }
            Text(verbatim: text)
                .lineLimit(1)
        }
        .font(monospaced ? .system(size: 10, weight: .medium, design: .monospaced) : .system(size: 10, weight: .medium))
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .foregroundStyle(style.foreground)
        .background(
            Capsule()
                .fill(style.background)
        )
        .overlay(
            Capsule()
                .stroke(style.border, lineWidth: 1)
        )
    }
}

struct PRBadgeView: View {
    let pr: PrEntry
    var clickable = true

    @ViewBuilder
    var body: some View {
        let badge = WorktreeBadge(text: prLabel(pr), style: prStyle(for: pr.state))
        if clickable, let destination = URL(string: pr.url) {
            Link(destination: destination) {
                badge
            }
            .buttonStyle(.plain)
        } else {
            badge
        }
    }
}

struct LinearBadgeView: View {
    let issue: LinkedLinearIssue
    var clickable = true

    @ViewBuilder
    var body: some View {
        let style = linearStyle(for: issue.state.color)
        let badge = WorktreeBadge(text: issue.identifier, style: style)

        if clickable, let destination = URL(string: issue.url) {
            Link(destination: destination) {
                badge
            }
            .buttonStyle(.plain)
            .help("\(issue.identifier) (\(issue.state.name))")
        } else {
            badge
                .help("\(issue.identifier) (\(issue.state.name))")
        }
    }
}

struct ServiceBadgeView: View {
    let service: ServiceStatus

    @ViewBuilder
    var body: some View {
        if let port = service.port {
            let badge = WorktreeBadge(
                text: "\(service.name):\(port)",
                style: service.running ? .success : .neutral,
                monospaced: true
            )

            if let url = service.url,
               let destination = URL(string: url),
               service.running {
                Link(destination: destination) {
                    badge
                }
                .buttonStyle(.plain)
            } else {
                badge
            }
        }
    }
}

func prLabel(_ pr: PrEntry) -> String {
    pr.repo.isEmpty ? "PR #\(pr.number)" : "\(pr.repo) #\(pr.number)"
}

func prStyle(for state: String) -> WorktreeBadgeStyle {
    switch state {
    case "merged":
        return .accent
    case "closed":
        return .danger
    case "open":
        return .success
    default:
        return .neutral
    }
}

private func linearStyle(for rawColor: String) -> WorktreeBadgeStyle {
    let color = Color(hex: rawColor) ?? .accentColor
    return WorktreeBadgeStyle(
        foreground: color,
        background: color.opacity(0.14),
        border: color.opacity(0.24)
    )
}

private extension Color {
    init?(hex: String) {
        let trimmed = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard trimmed.count == 6,
              let value = Int(trimmed, radix: 16) else {
            return nil
        }

        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
