import SwiftUI

struct WrappingFlowLayout: Layout {
    var spacing: CGFloat = 6
    var rowSpacing: CGFloat = 6

    func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let maxWidth = proposal.width ?? .greatestFiniteMagnitude
        let rows = arrangeRows(maxWidth: maxWidth, subviews: subviews)
        let width = rows.map { row in
            row.reduce(CGFloat.zero) { partial, item in
                partial + item.size.width
            } + spacing * CGFloat(max(0, row.count - 1))
        }.max() ?? 0
        let height = rows.reduce(CGFloat.zero) { partial, row in
            partial + (row.map(\.size.height).max() ?? 0)
        } + rowSpacing * CGFloat(max(0, rows.count - 1))

        return CGSize(width: width, height: height)
    }

    func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        let rows = arrangeRows(maxWidth: bounds.width, subviews: subviews)
        var y = bounds.minY

        for row in rows {
            var x = bounds.minX
            let rowHeight = row.map(\.size.height).max() ?? 0

            for item in row {
                item.subview.place(
                    at: CGPoint(x: x, y: y),
                    anchor: .topLeading,
                    proposal: ProposedViewSize(width: item.size.width, height: item.size.height)
                )
                x += item.size.width + spacing
            }

            y += rowHeight + rowSpacing
        }
    }

    private func arrangeRows(
        maxWidth: CGFloat,
        subviews: Subviews
    ) -> [[RowItem]] {
        var rows: [[RowItem]] = [[]]
        var currentRowWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            let needsNewRow = !rows[0].isEmpty &&
                !rows[rows.count - 1].isEmpty &&
                currentRowWidth + spacing + size.width > maxWidth

            if needsNewRow {
                rows.append([])
                currentRowWidth = 0
            }

            rows[rows.count - 1].append(RowItem(subview: subview, size: size))
            currentRowWidth += (rows[rows.count - 1].count == 1 ? 0 : spacing) + size.width
        }

        return rows
    }

    private struct RowItem {
        let subview: LayoutSubview
        let size: CGSize
    }
}
