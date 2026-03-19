import Foundation

struct BackendClient {
    let baseURL: URL
    let session: URLSession

    init(baseURL: URL, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func fetchProject() async throws -> ProjectSnapshot {
        try await request(path: "api/project", method: "GET", body: Optional<String>.none)
    }

    func createWorktree(mode: CreateWorktreeMode, branch: String?) async throws -> CreateWorktreeResponse {
        try await request(
            path: "api/worktrees",
            method: "POST",
            body: CreateWorktreeRequest(
                mode: mode,
                branch: branch?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
            )
        )
    }

    func openWorktree(named branch: String) async throws {
        _ = try await request(
            path: "api/worktrees/\(branch.urlPathEncoded)/open",
            method: "POST",
            body: Optional<String>.none
        ) as EmptyResponse
    }

    func closeWorktree(named branch: String) async throws {
        _ = try await request(
            path: "api/worktrees/\(branch.urlPathEncoded)/close",
            method: "POST",
            body: Optional<String>.none
        ) as EmptyResponse
    }

    func fetchTerminalLaunch(named branch: String) async throws -> NativeTerminalLaunch {
        try await request(
            path: "api/worktrees/\(branch.urlPathEncoded)/terminal-launch",
            method: "GET",
            body: Optional<String>.none
        )
    }

    func healthcheck() async -> Bool {
        do {
            _ = try await fetchProject()
            return true
        } catch {
            return false
        }
    }

    private func request<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        body: Body?
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method

        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BackendError.invalidResponse
        }

        if httpResponse.statusCode == 204 {
            guard let response = EmptyResponse() as? Response else {
                throw BackendError.invalidResponse
            }
            return response
        }

        if (200..<300).contains(httpResponse.statusCode) {
            do {
                return try JSONDecoder().decode(Response.self, from: data)
            } catch {
                throw BackendError.decodeFailed(error)
            }
        }

        if let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data) {
            throw BackendError.requestFailed(status: httpResponse.statusCode, message: payload.error)
        }

        let message = String(data: data, encoding: .utf8) ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
        throw BackendError.requestFailed(status: httpResponse.statusCode, message: message)
    }
}

enum BackendError: LocalizedError {
    case invalidResponse
    case decodeFailed(Error)
    case requestFailed(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Backend returned an invalid response."
        case .decodeFailed(let error):
            return "Backend response decode failed: \(error.localizedDescription)"
        case .requestFailed(_, let message):
            return message
        }
    }
}

private struct EmptyResponse: Decodable {}

private extension String {
    var urlPathEncoded: String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return addingPercentEncoding(withAllowedCharacters: allowed) ?? self
    }

    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
