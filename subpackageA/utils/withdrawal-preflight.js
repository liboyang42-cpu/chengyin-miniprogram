// 银行卡提现安全确认流程：准备 -> 用户确认 -> 服务端确认 -> 同事务建单。

function body(data) {
  return JSON.stringify(data)
}

function invoke(handlers, name, value) {
  if (handlers && typeof handlers[name] === 'function') handlers[name](value)
}

function submitBankWithdrawal(app, wxApi, data, handlers) {
  let completed = false
  const finish = () => {
    if (completed) return
    completed = true
    invoke(handlers, 'complete')
  }
  const fail = (error) => {
    invoke(handlers, 'fail', error)
    finish()
  }
  const rejectResponse = (response) => {
    invoke(handlers, 'success', response)
    finish()
  }
  const abnormal = (response) => {
    invoke(handlers, 'successStatusAbnormal', response)
    finish()
  }
  const preflightBody = {
    requestId: data.requestId,
    amount: data.withdrawalAmount,
    realname: data.realname,
    bankName: data.bankName,
    bankAccount: data.bankAccount,
    mobilephone: data.mobilephone,
  }

  try {
    app.sendRequest({
      hideLoading: true,
      autoErrorToast: false,
      url: '/api/fund/preflight/bank-withdrawal',
      method: 'POST',
      data: body(preflightBody),
      header: { 'Content-Type': 'application/json' },
      success(prepareResponse) {
        const challenge = prepareResponse && prepareResponse.data
        if (prepareResponse.code != '200' || !challenge || !challenge.challengeId
            || !challenge.challengeToken || challenge.canProceed !== true) {
          rejectResponse(prepareResponse && prepareResponse.code != '200'
            ? prepareResponse
            : { code: 409, msg: '当前提现风险确认未通过，请检查后重试' })
          return
        }
        const safety = Array.isArray(challenge.safetyMessages) && challenge.safetyMessages.length
          ? `\n${challenge.safetyMessages[0]}` : ''
        const content = `${challenge.question || '确认提交本次提现吗？'}\n${challenge.consequence || ''}${safety}`.trim()
        wxApi.showModal({
          title: '确认提现账户',
          content,
          confirmText: '确认提现',
          cancelText: '暂不提现',
          success(choice) {
            if (!choice || !choice.confirm) {
              try {
                app.sendRequest({
                  hideLoading: true,
                  autoErrorToast: false,
                  url: `/api/fund/preflight/${challenge.challengeId}/reject`,
                  method: 'POST',
                  data: body({ challengeToken: challenge.challengeToken }),
                  header: { 'Content-Type': 'application/json' },
                })
              } catch (ignored) {}
              invoke(handlers, 'cancel')
              finish()
              return
            }
            try {
              app.sendRequest({
                hideLoading: true,
                autoErrorToast: false,
                url: `/api/fund/preflight/${challenge.challengeId}/confirm`,
                method: 'POST',
                data: body({ challengeToken: challenge.challengeToken }),
                header: { 'Content-Type': 'application/json' },
                success(confirmResponse) {
                  if (confirmResponse.code != '200') {
                    rejectResponse(confirmResponse)
                    return
                  }
                  try {
                    app.sendRequest({
                      hideLoading: true,
                      autoErrorToast: false,
                      url: '/api/withdrawal/create',
                      method: 'POST',
                      data: body(Object.assign({}, data, { challengeId: challenge.challengeId })),
                      header: { 'Content-Type': 'application/json' },
                      success(response) { invoke(handlers, 'success', response) },
                      successStatusAbnormal: abnormal,
                      fail,
                      complete: finish,
                    })
                  } catch (error) { fail(error) }
                },
                successStatusAbnormal: abnormal,
                fail,
              })
            } catch (error) { fail(error) }
          },
          fail,
        })
      },
      successStatusAbnormal: abnormal,
      fail,
    })
  } catch (error) { fail(error) }
}

module.exports = { submitBankWithdrawal }
