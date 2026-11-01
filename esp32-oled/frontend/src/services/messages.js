// Plain-language messages for failures that are not about the form itself.
export function connectionProblem(error) {
  if (error?.code === 'timeout') {
    return 'The server did not answer in time. It may still be waking up; try again.';
  }
  if (error?.code === 'network') {
    return 'Could not reach the server. Check your internet connection and try again.';
  }
  if (error?.code === 'rate_limited') return 'Too many tries. Wait a minute, then try again.';
  return 'Something went wrong on our side. Try again in a moment.';
}
